//! "Meu trabalho": backlog, issues, PRs e atividade do dia, juntando commits
//! locais, GitHub e Azure DevOps. A configuração (fontes e preferências) fica
//! em `work.json`; os tokens, no Gerenciador de Credenciais (`auth.rs`).

pub mod ado;
pub mod auth;
pub mod github;
pub mod local;

use std::sync::OnceLock;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;

use crate::error::AppResult;
use crate::paths;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdoOrg {
    pub name: String,
    /// "account" (Entra/Azure CLI) ou "pat".
    pub auth: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkConfig {
    /// O onboarding da tela já foi concluído.
    pub onboarded: bool,
    /// Buscar issues e PRs no GitHub.
    pub github: bool,
    /// Organizações do Azure DevOps acompanhadas.
    pub ado_orgs: Vec<AdoOrg>,
    /// Bugs primeiro na lista "Para fazer".
    pub bugs_first: bool,
    /// Agente padrão para "Implementar": "auto" ou claude/codex/opencode.
    pub agent: String,
    /// Intervalo de atualização automática, em minutos.
    pub refresh_minutes: u32,
}

impl Default for WorkConfig {
    fn default() -> Self {
        Self {
            onboarded: false,
            github: true,
            ado_orgs: Vec::new(),
            bugs_first: true,
            agent: "auto".into(),
            refresh_minutes: 5,
        }
    }
}

fn file() -> std::path::PathBuf {
    paths::data_dir().join("work.json")
}

fn state() -> &'static RwLock<WorkConfig> {
    static S: OnceLock<RwLock<WorkConfig>> = OnceLock::new();
    S.get_or_init(|| {
        RwLock::new(
            std::fs::read(file())
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default(),
        )
    })
}

#[tauri::command]
pub fn work_config_get() -> WorkConfig {
    state().read().clone()
}

#[tauri::command]
pub fn work_config_set(config: WorkConfig) -> AppResult<WorkConfig> {
    let mut c = config;
    c.refresh_minutes = c.refresh_minutes.clamp(1, 120);
    paths::write_atomic(&file(), &serde_json::to_vec_pretty(&c)?)?;
    *state().write() = c.clone();
    Ok(c)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detect {
    /// Conta do GitHub conectada (login) e de onde vem o token.
    github_login: Option<String>,
    github_source: Option<&'static str>,
    github_name: Option<String>,
    github_avatar: Option<String>,
    gh_installed: bool,
    /// O Polvo tem app OAuth próprio (login sem CLI).
    github_native: bool,
    /// Conta Microsoft conectada pelo Polvo (Entra ID).
    entra_native: bool,
    entra_connected: bool,
    az_installed: bool,
    az_user: Option<String>,
}

/// Estado das contas: o que já está conectado e o que dá para usar.
#[tauri::command]
pub async fn work_detect() -> Detect {
    let token = tauri::async_runtime::spawn_blocking(auth::github_token)
        .await
        .ok()
        .flatten();
    let mut login = None;
    let mut name = None;
    let mut avatar = None;
    let mut source = None;
    if let Some((_, src)) = &token {
        if let Ok(v) = github::rest(reqwest::Method::GET, "/user", None).await {
            login = v.get("login").and_then(Value::as_str).map(str::to_string);
            name = v.get("name").and_then(Value::as_str).map(str::to_string);
            avatar = v
                .get("avatar_url")
                .and_then(Value::as_str)
                .map(str::to_string);
            source = Some(*src);
        }
    }
    let (az_installed, az_user) = tauri::async_runtime::spawn_blocking(|| {
        let installed = auth::cli_installed("az");
        (installed, installed.then(auth::az_user).flatten())
    })
    .await
    .unwrap_or((false, None));
    Detect {
        github_login: login,
        github_source: source,
        github_name: name,
        github_avatar: avatar,
        gh_installed: auth::cli_installed("gh"),
        github_native: auth::GITHUB_CLIENT_ID.is_some(),
        entra_native: auth::ENTRA_CLIENT_ID.is_some(),
        entra_connected: auth::entra_connected(),
        az_installed,
        az_user,
    }
}

#[tauri::command]
pub async fn work_github_login(progress: Channel<Value>) -> AppResult<()> {
    auth::github_login(progress).await
}

#[tauri::command]
pub fn work_github_logout() {
    auth::github_logout();
}

#[tauri::command]
pub async fn work_ado_login(progress: Channel<Value>) -> AppResult<Option<String>> {
    auth::ado_login(progress).await
}

#[tauri::command]
pub fn work_ado_logout(org: Option<String>) {
    match org {
        Some(o) => auth::pat_del(&o),
        None => auth::ado_logout(),
    }
}
