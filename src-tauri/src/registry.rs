//! Registro central das sessões. É a fonte da verdade compartilhada pelas
//! janelas: guarda o que é persistido (`workspace.json`) e o estado em tempo
//! de execução (status, prévia, código de saída).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
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
use crate::{bridge, discovery, paths, windows};

pub const EVT_SESSIONS: &str = "sessions-changed";
pub const EVT_RUNTIME: &str = "session-runtime";

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
        let opts = if rec.tool == ToolKind::Claude && settings.claude_usage_bridge {
            PlanOptions {
                claude_settings: bridge::claude_settings_file().ok(),
                user_statusline: discovery::claude_user_statusline(),
            }
        } else {
            PlanOptions::default()
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

    /// Ao abrir o app: retoma tudo (ou deixa pausado) e ajusta as janelas.
    pub fn boot(&self, app: &AppHandle, auto_resume: bool, screens: u8) {
        let ids: Vec<String> = {
            let mut inner = self.inner.lock();
            if screens < 2 {
                for s in inner
                    .ws
                    .sessions
                    .iter_mut()
                    .filter(|s| s.window != windows::MAIN)
                {
                    s.window = windows::MAIN.into();
                    s.minimized = true;
                }
            }
            inner.ws.sessions.iter().map(|s| s.id.clone()).collect()
        };
        if auto_resume {
            for id in ids {
                self.start(app, &id, StartMode::Resume);
            }
        }
    }

    pub fn move_all(&self, app: &AppHandle, from: &str, to: &str) {
        {
            let mut inner = self.inner.lock();
            for s in inner.ws.sessions.iter_mut().filter(|s| s.window == from) {
                s.window = to.into();
                s.minimized = true;
            }
            Self::save(&inner);
        }
        self.emit_sessions(app);
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
    minimized: Option<bool>,
    window: Option<String>,
}

/// Assíncrono: pode criar a janela da segunda tela.
#[tauri::command]
pub async fn session_update(
    app: AppHandle,
    reg: State<'_, Registry>,
    id: String,
    patch: SessionPatch,
) -> AppResult<()> {
    // Mover para a segunda tela reabre a janela dela se estiver fechada.
    if patch.window.as_deref() == Some(windows::SECOND) {
        windows::apply_screens(&app, 2)?;
    }
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
        }
        if let Some(m) = patch.minimized {
            r.minimized = m;
        }
        if let Some(w) = patch.window {
            r.window = w;
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
