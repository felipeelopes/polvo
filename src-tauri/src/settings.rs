//! Preferências do usuário (definidas no onboarding e na tela de ajustes).

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppResult, Context};
use crate::paths;
use crate::tools::ToolKind;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// O onboarding já foi concluído.
    pub onboarded: bool,
    /// Abrir o Polvo junto com o Windows.
    pub autostart: bool,
    /// Retomar as sessões abertas automaticamente ao iniciar.
    pub auto_resume: bool,
    /// Usar a ponte de statusline para ler os limites do Claude Code.
    pub claude_usage_bridge: bool,
    /// Procurar novas versões no GitHub.
    pub check_updates: bool,
    /// Fornecedores escondidos pelo usuário, mesmo que instalados.
    pub disabled_tools: Vec<ToolKind>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            onboarded: false,
            autostart: false,
            auto_resume: true,
            claude_usage_bridge: true,
            check_updates: true,
            disabled_tools: Vec::new(),
        }
    }
}

#[derive(Default)]
pub struct SettingsState(pub RwLock<Settings>);

impl SettingsState {
    pub fn load() -> Self {
        let s = std::fs::read(file())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self(RwLock::new(s))
    }

    pub fn get(&self) -> Settings {
        self.0.read().clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut Settings)) -> AppResult<Settings> {
        let mut s = self.0.write();
        f(&mut s);
        paths::write_atomic(&file(), &serde_json::to_vec_pretty(&*s)?)?;
        Ok(s.clone())
    }
}

fn file() -> std::path::PathBuf {
    paths::data_dir().join("settings.json")
}

#[tauri::command]
pub fn settings_get(state: State<SettingsState>) -> Settings {
    state.get()
}

#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    state: State<SettingsState>,
    settings: Settings,
) -> AppResult<Settings> {
    let saved = state.update(|s| *s = settings)?;
    sync_autostart(&app, saved.autostart)?;
    Ok(saved)
}

/// Deixa o registro de inicialização do Windows igual à preferência.
/// Em builds de desenvolvimento não mexe em nada: o executável de debug
/// depende do servidor do Vite e abriria uma janela em branco no login.
pub fn sync_autostart(app: &AppHandle, wanted: bool) -> AppResult<()> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let autolaunch = app.autolaunch();
    let enabled = autolaunch.is_enabled().unwrap_or(false);
    if wanted && !enabled {
        autolaunch
            .enable()
            .ctx("Não foi possível ativar a inicialização com o Windows")?;
    } else if !wanted && enabled {
        autolaunch
            .disable()
            .ctx("Não foi possível desativar a inicialização com o Windows")?;
    }
    Ok(())
}
