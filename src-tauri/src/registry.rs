//! Registro central das sessões. É a fonte da verdade compartilhada pelas
//! janelas: guarda o que é persistido (`workspace.json`) e o estado em tempo
//! de execução (status, prévia, código de saída).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::pty::PtyManager;
use crate::settings::SettingsState;
use crate::tools::{self, PlanOptions, StartMode, ToolKind};
use crate::windows::{self, WindowRecord};
use crate::{bridge, discovery, paths};

pub const EVT_SESSIONS: &str = "sessions-changed";
pub const EVT_RUNTIME: &str = "session-runtime";
pub const EVT_WINDOWS: &str = "windows-changed";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub tool: ToolKind,
    pub cwd: String,
    pub title: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default = "main_window")]
    pub window: String,
    #[serde(default)]
    pub minimized: bool,
    #[serde(default)]
    pub created_at: i64,
    /// O usuário renomeou: o título do terminal não substitui mais o nome.
    #[serde(default)]
    pub title_locked: bool,
    /// Cor da sessão (`/color` do CLI ou escolhida no Polvo).
    #[serde(default)]
    pub color: Option<String>,
    /// Último nome/cor vindos do CLI já aplicados (para não desfazer um
    /// renomear feito depois no Polvo).
    #[serde(default)]
    pub cli_title: Option<String>,
    #[serde(default)]
    pub cli_color: Option<String>,
}

fn main_window() -> String {
    windows::MAIN.into()
}

/// `paused` → `starting` → `working` / `waiting` / `idle` → `exited` (ou `error`).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub status: String,
    pub since: i64,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    pub preview: Vec<String>,
    #[serde(skip)]
    generation: u64,
}

impl Runtime {
    fn new(status: &str) -> Self {
        Self {
            status: status.into(),
            since: paths::now_ms(),
            exit_code: None,
            error: None,
            preview: vec![],
            generation: 0,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    #[serde(flatten)]
    pub record: SessionRecord,
    pub runtime: Runtime,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct RuntimeEvent<'a> {
    id: &'a str,
    runtime: &'a Runtime,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct WorkspaceFile {
    version: u32,
    sessions: Vec<SessionRecord>,
    /// Janelas abertas (reabertas ao iniciar).
    windows: Vec<WindowRecord>,
    /// Árvore de layout de cada janela (formato definido pelo frontend).
    layouts: HashMap<String, Value>,
    /// Visão ativa de cada janela: `tiles` ou `board`.
    views: HashMap<String, String>,
    recent_dirs: Vec<String>,
}

#[derive(Default)]
struct Inner {
    ws: WorkspaceFile,
    runtime: HashMap<String, Runtime>,
}

#[derive(Default)]
pub struct Registry {
    inner: Mutex<Inner>,
    /// O app está encerrando: janelas fechadas agora continuam lembradas.
    exiting: AtomicBool,
    /// Janelas que o usuário pediu para fechar (botão X). Só essas são
    /// esquecidas; as destruídas pelo encerramento do app reabrem depois.
    user_closing: Mutex<HashSet<String>>,
}

fn workspace_file() -> PathBuf {
    paths::data_dir().join("workspace.json")
}

impl Registry {
    pub fn load() -> Self {
        let ws: WorkspaceFile = std::fs::read(workspace_file())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let runtime = ws
            .sessions
            .iter()
            .map(|s| (s.id.clone(), Runtime::new("paused")))
            .collect();
        Self {
            inner: Mutex::new(Inner { ws, runtime }),
            exiting: AtomicBool::new(false),
            user_closing: Mutex::new(HashSet::new()),
        }
    }

    fn save(inner: &Inner) {
        let mut ws = serde_json::to_value(&inner.ws).unwrap_or_default();
        ws["version"] = 1.into();
        if let Ok(bytes) = serde_json::to_vec_pretty(&ws) {
            if let Err(e) = paths::write_atomic(&workspace_file(), &bytes) {
                log::error!("não foi possível salvar o workspace: {e}");
            }
        }
    }

    pub fn views(&self) -> Vec<SessionView> {
        let inner = self.inner.lock();
        inner
            .ws
            .sessions
            .iter()
            .map(|r| SessionView {
                record: r.clone(),
                runtime: inner
                    .runtime
                    .get(&r.id)
                    .cloned()
                    .unwrap_or_else(|| Runtime::new("paused")),
            })
            .collect()
    }

    fn emit_sessions(&self, app: &AppHandle) {
        let _ = app.emit(EVT_SESSIONS, self.views());
    }

    fn emit_runtime(&self, app: &AppHandle, id: &str) {
        let inner = self.inner.lock();
        if let Some(rt) = inner.runtime.get(id) {
            let _ = app.emit(EVT_RUNTIME, RuntimeEvent { id, runtime: rt });
        }
    }

    fn record(&self, id: &str) -> AppResult<SessionRecord> {
        self.inner
            .lock()
            .ws
            .sessions
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| AppError::msg("Sessão não encontrada"))
    }

    fn claimed_ids(&self, except: &str) -> HashSet<String> {
        self.inner
            .lock()
            .ws
            .sessions
            .iter()
            .filter(|s| s.id != except)
            .filter_map(|s| s.session_id.clone())
            .collect()
    }

    /// Inicia (ou reinicia) o processo de uma sessão.
    pub fn start(&self, app: &AppHandle, id: &str, mode: StartMode) {
        let result = self.try_start(app, id, mode);
        {
            let mut inner = self.inner.lock();
            if let Err(e) = &result {
                let rt = inner
                    .runtime
                    .entry(id.to_string())
                    .or_insert_with(|| Runtime::new("error"));
                *rt = Runtime {
                    error: Some(e.to_string()),
                    ..Runtime::new("error")
                };
            }
            Self::save(&inner);
        }
        self.emit_sessions(app);
    }

    fn try_start(&self, app: &AppHandle, id: &str, mode: StartMode) -> AppResult<()> {
        let rec = self.record(id)?;
        let cwd = PathBuf::from(&rec.cwd);
        if !cwd.is_dir() {
            return Err(AppError::msg(format!(
                "A pasta {} não existe mais.",
                rec.cwd
            )));
        }
        let settings = app.state::<SettingsState>().get();
        let opts = PlanOptions {
            claude_settings: (rec.tool == ToolKind::Claude && settings.claude_usage_bridge)
                .then(|| bridge::claude_settings_file().ok())
                .flatten(),
            user_statusline: (rec.tool == ToolKind::Claude && settings.claude_usage_bridge)
                .then(discovery::claude_user_statusline)
                .flatten(),
            claude_bypass: settings.claude_bypass_permissions,
        };
        let mode = if mode == StartMode::Resume
            && rec.session_id.is_none()
            && rec.tool != ToolKind::Claude
        {
            StartMode::New
        } else {
            mode
        };
        let plan = tools::plan(rec.tool, mode, rec.session_id.as_deref(), &cwd, &opts)?;
        let started_at = SystemTime::now();
        let generation = app.state::<PtyManager>().spawn(app, id, &plan, &cwd)?;

        {
            let mut inner = self.inner.lock();
            if let Some(r) = inner.ws.sessions.iter_mut().find(|s| s.id == id) {
                if plan.session_id.is_some() {
                    r.session_id = plan.session_id.clone();
                } else if plan.discover {
                    r.session_id = None;
                }
            }
            inner.runtime.insert(
                id.to_string(),
                Runtime {
                    generation,
                    ..Runtime::new("starting")
                },
            );
        }

        if plan.discover {
            self.spawn_discovery(
                app.clone(),
                id.to_string(),
                rec.tool,
                cwd,
                started_at,
                generation,
            );
        }
        Ok(())
    }

    /// Codex e OpenCode só criam o id depois de iniciar: procura em segundo plano.
    fn spawn_discovery(
        &self,
        app: AppHandle,
        id: String,
        tool: ToolKind,
        cwd: PathBuf,
        since: SystemTime,
        generation: u64,
    ) {
        let _ = thread::Builder::new()
            .name(format!("discover-{id}"))
            .spawn(move || {
                let reg = app.state::<Registry>();
                for _ in 0..600 {
                    thread::sleep(Duration::from_secs(3));
                    if reg.generation(&id) != Some(generation) {
                        return;
                    }
                    let claimed = reg.claimed_ids(&id);
                    let found = match tool {
                        ToolKind::Codex => discovery::codex_discover(&cwd, since, &claimed),
                        ToolKind::Opencode => {
                            discovery::opencode_discover(&cwd, paths::to_ms(since), &claimed)
                        }
                        _ => None,
                    };
                    if let Some(session_id) = found {
                        log::info!("sessão {id} vinculada a {session_id}");
                        reg.set_session_id(&app, &id, session_id);
                        return;
                    }
                }
            });
    }

    fn generation(&self, id: &str) -> Option<u64> {
        self.inner.lock().runtime.get(id).map(|r| r.generation)
    }

    fn set_session_id(&self, app: &AppHandle, id: &str, session_id: String) {
        {
            let mut inner = self.inner.lock();
            if let Some(r) = inner.ws.sessions.iter_mut().find(|s| s.id == id) {
                r.session_id = Some(session_id);
            }
            Self::save(&inner);
        }
        self.emit_sessions(app);
    }

    pub fn on_exit(&self, app: &AppHandle, id: &str, generation: u64, code: i32) {
        {
            let mut inner = self.inner.lock();
            match inner.runtime.get_mut(id) {
                Some(rt) if rt.generation == generation => {
                    *rt = Runtime {
                        exit_code: Some(code),
                        generation,
                        ..Runtime::new("exited")
                    };
                }
                _ => return,
            }
        }
        app.state::<PtyManager>().forget(id);
        self.emit_runtime(app, id);
    }

    /// Ao abrir o app: garante a janela principal, devolve sessões órfãs a
    /// ela e retoma tudo (ou deixa pausado).
    pub fn boot(&self, app: &AppHandle, auto_resume: bool) {
        let ids: Vec<String> = {
            let mut inner = self.inner.lock();
            if !inner.ws.windows.iter().any(|w| w.label == windows::MAIN) {
                inner.ws.windows.insert(
                    0,
                    WindowRecord {
                        label: windows::MAIN.into(),
                        name: "Janela 1".into(),
                    },
                );
            }
            let open: HashSet<String> = inner.ws.windows.iter().map(|w| w.label.clone()).collect();
            for s in inner
                .ws
                .sessions
                .iter_mut()
                .filter(|s| !open.contains(&s.window))
            {
                s.window = windows::MAIN.into();
                s.minimized = true;
            }
            Self::save(&inner);
            inner.ws.sessions.iter().map(|s| s.id.clone()).collect()
        };
        if auto_resume {
            for id in ids {
                self.start(app, &id, StartMode::Resume);
            }
        }
    }

    /// (id do Polvo, ferramenta, id da sessão do CLI) das sessões em execução.
    pub fn session_refs(&self) -> Vec<(String, ToolKind, Option<String>)> {
        let inner = self.inner.lock();
        inner
            .ws
            .sessions
            .iter()
            .filter(|s| {
                inner
                    .runtime
                    .get(&s.id)
                    .is_some_and(|r| !matches!(r.status.as_str(), "paused" | "error"))
            })
            .map(|s| (s.id.clone(), s.tool, s.session_id.clone()))
            .collect()
    }

    /// Aplica nome (`/rename`) e cor (`/color`) definidos no CLI quando mudam.
    /// Sem `/rename`, o título automático do CLI vale se o nome não estiver fixo.
    pub fn apply_cli_meta(
        &self,
        app: &AppHandle,
        metas: &HashMap<String, crate::context::SessionMeta>,
    ) {
        let mut changed = false;
        {
            let mut inner = self.inner.lock();
            for r in inner.ws.sessions.iter_mut() {
                let Some(m) = metas.get(&r.id) else { continue };
                if let Some(t) = m.custom_title.as_ref().filter(|t| !t.trim().is_empty()) {
                    if r.cli_title.as_ref() != Some(t) {
                        r.cli_title = Some(t.clone());
                        r.title = t.trim().to_string();
                        r.title_locked = true;
                        changed = true;
                    }
                } else if let Some(t) = m.ai_title.as_ref().filter(|t| !t.trim().is_empty()) {
                    if !r.title_locked && r.title != *t {
                        r.title = t.trim().to_string();
                        changed = true;
                    }
                }
                if let Some(c) = &m.color {
                    if r.cli_color.as_ref() != Some(c) {
                        r.cli_color = Some(c.clone());
                        r.color = Some(c.clone()).filter(|c| c != "default");
                        changed = true;
                    }
                }
            }
            if changed {
                Self::save(&inner);
            }
        }
        if changed {
            self.emit_sessions(app);
        }
    }

    pub fn windows(&self) -> Vec<WindowRecord> {
        self.inner.lock().ws.windows.clone()
    }

    fn emit_windows(&self, app: &AppHandle) {
        let _ = app.emit(EVT_WINDOWS, self.windows());
    }

    /// Registra uma janela nova com o menor número livre ("Janela 2", "Janela 3"…).
    pub fn add_window(&self, app: &AppHandle) -> WindowRecord {
        let rec = {
            let mut inner = self.inner.lock();
            let used: HashSet<String> = inner.ws.windows.iter().map(|w| w.name.clone()).collect();
            let n = (2..)
                .find(|n| !used.contains(&format!("Janela {n}")))
                .unwrap_or(2);
            let id = uuid::Uuid::new_v4().simple().to_string();
            let rec = WindowRecord {
                label: format!("w-{}", &id[..8]),
                name: format!("Janela {n}"),
            };
            inner.ws.windows.push(rec.clone());
            Self::save(&inner);
            rec
        };
        self.emit_windows(app);
        rec
    }

    /// Fechar a janela principal encerra o app e mantém todas as janelas lembradas.
    pub fn mark_exiting(&self) {
        self.exiting.store(true, Ordering::SeqCst);
    }

    /// O usuário clicou para fechar uma janela extra.
    pub fn mark_user_closing(&self, label: &str) {
        self.user_closing.lock().insert(label.to_string());
    }

    /// Uma janela extra foi destruída. Se foi o usuário que a fechou (e o app
    /// não está encerrando), ela é esquecida e as sessões vão para o trilho
    /// da principal.
    pub fn window_closed(&self, app: &AppHandle, label: &str) {
        let by_user = self.user_closing.lock().remove(label);
        if !by_user || self.exiting.load(Ordering::SeqCst) || label == windows::MAIN {
            return;
        }
        let moved = {
            let mut inner = self.inner.lock();
            inner.ws.windows.retain(|w| w.label != label);
            inner.ws.layouts.remove(label);
            inner.ws.views.remove(label);
            let mut moved = 0;
            for s in inner.ws.sessions.iter_mut().filter(|s| s.window == label) {
                s.window = windows::MAIN.into();
                s.minimized = true;
                moved += 1;
            }
            Self::save(&inner);
            moved
        };
        self.emit_windows(app);
        if moved > 0 {
            self.emit_sessions(app);
        }
    }
}

// ---------------------------------------------------------------- comandos

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    sessions: Vec<SessionView>,
    layout: Option<Value>,
    view: String,
    recent_dirs: Vec<String>,
}

#[tauri::command]
pub fn workspace_snapshot(reg: State<Registry>, window: String) -> Snapshot {
    let sessions = reg.views();
    let inner = reg.inner.lock();
    Snapshot {
        sessions,
        layout: inner.ws.layouts.get(&window).cloned(),
        view: inner
            .ws
            .views
            .get(&window)
            .cloned()
            .unwrap_or_else(|| "tiles".into()),
        recent_dirs: inner.ws.recent_dirs.clone(),
    }
}

#[tauri::command]
pub fn layout_save(reg: State<Registry>, window: String, layout: Value, view: String) {
    let mut inner = reg.inner.lock();
    inner.ws.layouts.insert(window.clone(), layout);
    inner.ws.views.insert(window, view);
    Registry::save(&inner);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    tool: ToolKind,
    cwd: String,
    title: Option<String>,
    mode: StartMode,
    window: String,
}

#[tauri::command]
pub fn session_create(
    app: AppHandle,
    reg: State<Registry>,
    req: CreateRequest,
) -> AppResult<String> {
    let cwd = req.cwd.trim().to_string();
    if !Path::new(&cwd).is_dir() {
        return Err(AppError::msg("Escolha uma pasta que exista."));
    }
    let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
    let folder = Path::new(&cwd)
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_else(|| cwd.clone());
    // Um nome dado na criação fica fixo; sem nome, o título do terminal assume.
    let named = req.title.as_ref().is_some_and(|t| !t.trim().is_empty());
    let title = req.title.filter(|t| !t.trim().is_empty()).unwrap_or(folder);
    {
        let mut inner = reg.inner.lock();
        inner.ws.sessions.push(SessionRecord {
            id: id.clone(),
            tool: req.tool,
            cwd: cwd.clone(),
            title,
            session_id: None,
            window: req.window,
            minimized: false,
            created_at: paths::now_ms(),
            title_locked: named,
            color: None,
            cli_title: None,
            cli_color: None,
        });
        inner.runtime.insert(id.clone(), Runtime::new("starting"));
        inner.ws.recent_dirs.retain(|d| !paths::same_path(d, &cwd));
        inner.ws.recent_dirs.insert(0, cwd);
        inner.ws.recent_dirs.truncate(12);
    }
    reg.start(&app, &id, req.mode);
    Ok(id)
}

#[tauri::command]
pub fn session_start(app: AppHandle, reg: State<Registry>, id: String) {
    reg.start(&app, &id, StartMode::Resume);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    title: Option<String>,
    /// Título vindo do terminal (o CLI o define); ignorado se o nome estiver travado.
    auto_title: Option<String>,
    /// Cor da sessão; texto vazio volta à cor da ferramenta.
    color: Option<String>,
    minimized: Option<bool>,
    window: Option<String>,
}

#[tauri::command]
pub fn session_update(
    app: AppHandle,
    reg: State<Registry>,
    id: String,
    patch: SessionPatch,
) -> AppResult<()> {
    {
        let mut inner = reg.inner.lock();
        let r = inner
            .ws
            .sessions
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| AppError::msg("Sessão não encontrada"))?;
        if let Some(t) = patch.title.filter(|t| !t.trim().is_empty()) {
            r.title = t.trim().to_string();
            r.title_locked = true;
        }
        if let Some(t) = patch.auto_title.filter(|t| !t.trim().is_empty()) {
            if !r.title_locked {
                r.title = t.trim().to_string();
            }
        }
        if let Some(c) = patch.color {
            r.color = Some(c.trim().to_string()).filter(|c| !c.is_empty() && c != "default");
        }
        if let Some(m) = patch.minimized {
            r.minimized = m;
        }
        if let Some(w) = patch.window {
            r.window = w;
        }
        let window = r.window.clone();
        if !inner.ws.windows.iter().any(|w| w.label == window) {
            return Err(AppError::msg("Essa janela não está aberta."));
        }
        Registry::save(&inner);
    }
    reg.emit_sessions(&app);
    Ok(())
}

#[tauri::command]
pub fn session_close(app: AppHandle, reg: State<Registry>, pty: State<PtyManager>, id: String) {
    pty.kill(&id);
    {
        let mut inner = reg.inner.lock();
        inner.ws.sessions.retain(|s| s.id != id);
        inner.runtime.remove(&id);
        Registry::save(&inner);
    }
    reg.emit_sessions(&app);
}

/// A janela dona da sessão informa o que detectou no terminal.
#[tauri::command]
pub fn session_report(
    app: AppHandle,
    reg: State<Registry>,
    id: String,
    status: String,
    preview: Vec<String>,
) {
    let changed = {
        let mut inner = reg.inner.lock();
        let Some(rt) = inner.runtime.get_mut(&id) else {
            return;
        };
        if matches!(rt.status.as_str(), "exited" | "error" | "paused") {
            return;
        }
        let mut changed = false;
        if rt.status != status {
            rt.status = status;
            rt.since = paths::now_ms();
            changed = true;
        }
        if rt.preview != preview {
            rt.preview = preview;
            changed = true;
        }
        changed
    };
    if changed {
        reg.emit_runtime(&app, &id);
    }
}
