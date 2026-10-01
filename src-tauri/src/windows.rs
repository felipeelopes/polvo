//! Janelas do Polvo. Dá para abrir quantas quiser ("instâncias"), cada uma no
//! monitor que preferir. As janelas abertas são lembradas e reabertas no mesmo
//! lugar ao iniciar (posição e tamanho via tauri-plugin-window-state).

use serde::{Deserialize, Serialize};
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::Effect;
use tauri::{
    AppHandle, Manager, Monitor, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::error::{AppError, AppResult};
use crate::registry::Registry;

/// Janela principal: fechá-la encerra o Polvo (todas as janelas são lembradas).
pub const MAIN: &str = "main";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowRecord {
    pub label: String,
    pub name: String,
}

/// Cria a janela. `place_elsewhere` posiciona num monitor sem janelas do Polvo
/// (ou em cascata, se não houver). Janelas restauradas ignoram isso: o plugin
/// de estado devolve a posição e o tamanho salvos.
pub fn open(
    app: &AppHandle,
    rec: &WindowRecord,
    place_elsewhere: bool,
) -> AppResult<WebviewWindow> {
    let mut builder =
        WebviewWindowBuilder::new(app, &rec.label, WebviewUrl::App("index.html".into()))
            .title(crate::i18n::tr("windows.title", &[("name", &rec.name)]))
            .decorations(false)
            .transparent(true)
            .effects(WindowEffectsConfig {
                effects: vec![Effect::Mica],
                ..Default::default()
            })
            .min_inner_size(900.0, 560.0)
            .inner_size(1280.0, 800.0);

    if place_elsewhere {
        let (monitor, offset) = target_monitor(app);
        match monitor {
            Some(m) => {
                let sf = m.scale_factor();
                let pos = m.position();
                builder = builder.position(pos.x as f64 / sf + offset, pos.y as f64 / sf + offset);
            }
            None => builder = builder.center(),
        }
    }
    Ok(builder.build()?)
}

/// Prefere um monitor sem janelas do Polvo; senão, cascata no monitor atual.
fn target_monitor(app: &AppHandle) -> (Option<Monitor>, f64) {
    let Some(main) = app.webview_windows().into_values().next() else {
        return (None, 0.0);
    };
    let used: Vec<String> = app
        .webview_windows()
        .values()
        .filter_map(|w| w.current_monitor().ok().flatten())
        .filter_map(|m| m.name().cloned())
        .collect();
    let free = main
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .find(|m| m.name().is_none_or(|n| !used.contains(n)));
    match free {
        Some(m) => (Some(m), 60.0),
        None => {
            let cascade = 40.0 * app.webview_windows().len() as f64;
            (main.current_monitor().ok().flatten(), 40.0 + cascade)
        }
    }
}

/// Reabre as janelas que estavam abertas da última vez.
pub fn restore(app: &AppHandle) {
    for rec in app.state::<Registry>().windows() {
        if rec.label != MAIN && app.get_webview_window(&rec.label).is_none() {
            match open(app, &rec, false) {
                Ok(_) => log::info!("janela {} reaberta", rec.label),
                Err(e) => log::warn!("não foi possível reabrir {}: {e}", rec.label),
            }
        }
    }
}

// ---------------------------------------------------------------- comandos

/// Assíncrono de propósito: criar janelas num comando síncrono trava a
/// thread principal no Windows.
#[tauri::command]
pub async fn window_new(app: AppHandle, reg: State<'_, Registry>) -> AppResult<String> {
    let rec = reg.add_window(&app);
    open(&app, &rec, true)?;
    Ok(rec.label)
}

#[tauri::command]
pub fn windows_list(reg: State<Registry>) -> Vec<WindowRecord> {
    reg.windows()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    index: usize,
    name: String,
    width: u32,
    height: u32,
    primary: bool,
    current: bool,
}

#[tauri::command]
pub fn monitors_list(window: WebviewWindow) -> Vec<MonitorInfo> {
    let name_of = |m: Option<Monitor>| m.and_then(|m| m.name().cloned());
    let primary = name_of(window.primary_monitor().ok().flatten());
    let current = name_of(window.current_monitor().ok().flatten());
    window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(index, m)| {
            let name = m.name().cloned().unwrap_or_default();
            MonitorInfo {
                index,
                width: m.size().width,
                height: m.size().height,
                primary: primary.as_ref() == Some(&name),
                current: current.as_ref() == Some(&name),
                name,
            }
        })
        .collect()
}

/// Leva a janela para o monitor escolhido e a maximiza lá.
#[tauri::command]
pub async fn window_to_monitor(window: WebviewWindow, index: usize) -> AppResult<()> {
    let monitors = window.available_monitors()?;
    let m = monitors
        .get(index)
        .ok_or_else(|| AppError::msg(crate::i18n::tr("windows.monitorNotFound", &[])))?;
    window.unmaximize()?;
    let pos = m.position();
    window.set_position(PhysicalPosition::new(pos.x + 60, pos.y + 60))?;
    window.maximize()?;
    window.set_focus()?;
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
pub fn display_info(window: WebviewWindow) -> DisplayInfo {
    DisplayInfo {
        monitors: window.available_monitors().map(|m| m.len()).unwrap_or(1),
        mica: windows_build() >= 22000,
    }
}

/// Mostra e foca uma janela (usado ao clicar numa sessão de outra janela).
#[tauri::command]
pub fn window_focus(app: AppHandle, label: String) -> AppResult<()> {
    let w = app
        .get_webview_window(&label)
        .ok_or_else(|| AppError::msg(crate::i18n::tr("windows.windowNotFound", &[])))?;
    w.unminimize()?;
    w.show()?;
    w.set_focus()?;
    Ok(())
}

/// Abre links (http/https) no navegador padrão.
#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::msg(crate::i18n::tr(
            "windows.unsupportedUrl",
            &[],
        )));
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
