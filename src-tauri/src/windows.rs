//! Janelas: a principal e, opcionalmente, uma segunda no outro monitor.

use serde::Serialize;
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::Effect;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

pub const MAIN: &str = "main";
pub const SECOND: &str = "screen-2";

pub fn apply_screens(app: &AppHandle, screens: u8) -> AppResult<()> {
    if screens >= 2 {
        if app.get_webview_window(SECOND).is_none() {
            open_second(app)?;
        }
    } else if let Some(w) = app.get_webview_window(SECOND) {
        app.state::<crate::registry::Registry>()
            .move_all(app, SECOND, MAIN);
        w.destroy()?;
    }
    Ok(())
}

fn open_second(app: &AppHandle) -> AppResult<()> {
    let main = app
        .get_webview_window(MAIN)
        .ok_or_else(|| AppError::msg("Janela principal não encontrada"))?;
    let current = main.current_monitor()?.map(|m| m.name().cloned());
    let target = main
        .available_monitors()?
        .into_iter()
        .find(|m| Some(m.name().cloned()) != current);

    let mut builder = WebviewWindowBuilder::new(app, SECOND, WebviewUrl::App("index.html".into()))
        .title("Polvo — Tela 2")
        .decorations(false)
        .transparent(true)
        .effects(WindowEffectsConfig {
            effects: vec![Effect::Mica],
            ..Default::default()
        })
        .min_inner_size(900.0, 560.0)
        .inner_size(1280.0, 800.0);

    match target {
        Some(m) => {
            let sf = m.scale_factor();
            let pos = m.position();
            builder = builder
                .position(pos.x as f64 / sf + 40.0, pos.y as f64 / sf + 40.0)
                .maximized(true);
        }
        // Só um monitor: abre ao lado, para o usuário posicionar quando conectar o outro.
        None => builder = builder.center(),
    }
    builder.build()?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    monitors: usize,
    /// Windows 11 (build 22000+) suporta o efeito Mica.
    mica: bool,
}

#[tauri::command]
pub fn display_info(app: AppHandle) -> DisplayInfo {
    let monitors = app
        .get_webview_window(MAIN)
        .and_then(|w| w.available_monitors().ok())
        .map(|m| m.len())
        .unwrap_or(1);
    DisplayInfo {
        monitors,
        mica: windows_build() >= 22000,
    }
}

/// Mostra e foca uma janela (usado ao clicar numa sessão de outra tela).
#[tauri::command]
pub fn window_focus(app: AppHandle, label: String) -> AppResult<()> {
    let w = app
        .get_webview_window(&label)
        .ok_or_else(|| AppError::msg("Janela não encontrada"))?;
    w.unminimize()?;
    w.show()?;
    w.set_focus()?;
    Ok(())
}

/// Abre links (http/https) no navegador padrão.
#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::msg("Endereço não suportado"));
    }
    std::process::Command::new("explorer").arg(&url).spawn()?;
    Ok(())
}

#[cfg(windows)]
fn windows_build() -> u32 {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
        .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
        .ok()
        .and_then(|b| b.parse().ok())
        .unwrap_or(0)
}

#[cfg(not(windows))]
fn windows_build() -> u32 {
    0
}
