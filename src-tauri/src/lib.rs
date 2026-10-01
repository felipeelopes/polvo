//! Polvo — organize sessões de Claude Code, Codex, OpenCode e shells lado a lado.

pub mod bridge;
mod discovery;
mod error;
mod paths;
mod pty;
mod registry;
mod settings;
mod tools;
mod usage;
mod windows;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_window_state::StateFlags;

use pty::PtyManager;
use registry::Registry;
use settings::SettingsState;

pub fn run() {
    let app = tauri::Builder::default()
        // Uma só instância: abrir de novo apenas traz a janela para frente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window(windows::MAIN) {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .with_denylist(&[windows::SECOND])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SettingsState::load())
        .manage(Registry::load())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            settings::settings_get,
            settings::settings_set,
            tools::tools_available,
            registry::workspace_snapshot,
            registry::layout_save,
            registry::session_create,
            registry::session_start,
            registry::session_update,
            registry::session_close,
            registry::session_report,
            pty::pty_attach,
            pty::pty_write,
            pty::pty_resize,
            usage::usage_get,
            windows::display_info,
            windows::window_focus,
            windows::open_url,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = app.state::<SettingsState>().get();
            // Reaplica a inicialização com o Windows (ex.: após instalar ou mover o app).
            if settings.onboarded {
                if let Err(e) = settings::sync_autostart(&handle, settings.autostart) {
                    log::warn!("{e}");
                }
            }
            app.state::<Registry>().boot(
                &handle,
                settings.onboarded && settings.auto_resume,
                settings.screens,
            );
            if settings.onboarded && settings.screens >= 2 {
                if let Err(e) = windows::apply_screens(&handle, 2) {
                    log::warn!("não foi possível abrir a segunda tela: {e}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let app = window.app_handle();
                match window.label() {
                    // Fechar a janela principal encerra o app (e a segunda tela).
                    windows::MAIN => app.exit(0),
                    // Fechar a segunda tela devolve as sessões para a principal.
                    windows::SECOND => {
                        app.state::<Registry>()
                            .move_all(app, windows::SECOND, windows::MAIN);
                    }
                    _ => {}
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Polvo");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            app.state::<PtyManager>().kill_all();
        }
    });
}
