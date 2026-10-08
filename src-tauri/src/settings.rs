//! Preferências do usuário (definidas no onboarding e na tela de ajustes).

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State, Theme};
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
    /// "Abrir no Polvo" no menu do Explorer (Shift + clique direito).
    pub explorer_menu: bool,
    /// Iniciar o Claude Code com `--permission-mode bypassPermissions`.
    pub claude_bypass_permissions: bool,
    /// Idioma da interface: "auto" (o do Windows) ou um código como "en", "pt".
    pub language: String,
    /// Tema: "auto" (segue o Windows), "light" ou "dark".
    pub theme: String,
    /// Terminal escuro mesmo no tema claro.
    pub terminal_dark: bool,
    /// Modelo do ditado: "auto" (large-v3-turbo na GPU, small na CPU),
    /// "turbo", "small" ou "base".
    pub voice_model: String,
    /// Idioma do ditado: "app" (o da interface) ou "auto" (detecta pela fala).
    pub voice_language: String,
    /// Nomes e termos que o usuário costuma falar (contexto para o Whisper).
    pub voice_vocabulary: String,
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
            explorer_menu: true,
            claude_bypass_permissions: true,
            language: "auto".into(),
            theme: "auto".into(),
            terminal_dark: false,
            voice_model: "auto".into(),
            voice_language: "app".into(),
            voice_vocabulary: String::new(),
        }
    }
}

#[derive(Default)]
pub struct SettingsState(pub RwLock<Settings>);

impl SettingsState {
    pub fn load() -> Self {
        let s: Settings = std::fs::read(file())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        crate::i18n::set_language(&s.language);
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
    crate::i18n::set_language(&saved.language);
    apply_theme(&app, &saved.theme);
    let _ = app.emit("settings-changed", &saved);
    sync_autostart(&app, saved.autostart)?;
    crate::explorer::sync_menu(saved.explorer_menu)?;
    Ok(saved)
}

/// Aplica o tema em todas as janelas (e nas que abrirem depois). O Mica e o
/// `prefers-color-scheme` do WebView2 acompanham o tema da janela.
pub fn apply_theme(app: &AppHandle, theme: &str) {
    app.set_theme(match theme {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    });
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
            .ctx(&crate::i18n::tr("settings.autostartEnableFailed", &[]))?;
    } else if !wanted && enabled {
        autolaunch
            .disable()
            .ctx(&crate::i18n::tr("settings.autostartDisableFailed", &[]))?;
    }
    Ok(())
}
