//! Polvo — organize sessões de Claude Code, Codex, OpenCode e shells lado a lado.

pub mod bridge;
mod context;
mod discovery;
mod error;
mod explorer;
mod files;
mod git;
mod gitops;
pub mod i18n;
mod paths;
mod projects;
mod pty;
mod registry;
mod settings;
mod tools;
mod usage;
mod versions;
mod windows;
mod work;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_window_state::StateFlags;

use pty::PtyManager;
use registry::Registry;
use settings::SettingsState;

pub fn run() {
    let app = tauri::Builder::default()
        // Um processo só, várias janelas: abrir o Polvo de novo (menu Iniciar,
        // atalho) cria uma nova janela, que pode ir para qualquer monitor.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|a| a == "--autostart") {
                return;
            }
            // "Abrir no Polvo" no Explorer: pergunta qual ferramenta abrir na pasta.
            if let Some(folder) = explorer::folder_from_args(&args) {
                explorer::deliver(app, folder);
                return;
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let rec = app.state::<Registry>().add_window(&app);
                if let Err(e) = windows::open(&app, &rec, true) {
                    log::warn!("não foi possível abrir nova janela: {e}");
                }
            });
        }))
        // Log no console e em %LOCALAPPDATA%\dev.polvo.app\logs (ajuda a reportar bugs).
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .build(),
        )
        // Lembra posição, tamanho e monitor de cada janela.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
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
        .manage(explorer::PendingOpen(std::sync::Mutex::new(
            explorer::folder_from_args(&std::env::args().collect::<Vec<_>>()),
        )))
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
            context::session_meta,
            windows::display_info,
            windows::window_focus,
            windows::window_new,
            windows::windows_list,
            windows::monitors_list,
            windows::window_to_monitor,
            windows::open_url,
            explorer::open_folder_take,
            git::git_info,
            gitops::git_status,
            gitops::git_summaries,
            gitops::git_diff,
            gitops::git_file_at,
            gitops::git_stage,
            gitops::git_unstage,
            gitops::git_apply,
            gitops::git_discard,
            gitops::git_commit,
            gitops::git_undo_commit,
            gitops::git_ignore,
            gitops::git_init,
            gitops::git_log,
            gitops::git_commit_files,
            gitops::git_branches,
            gitops::git_action,
            gitops::git_stashes,
            gitops::git_remote,
            gitops::git_web_url,
            gitops::gh_prs,
            gitops::gh_pr_create,
            gitops::git_ai_message,
            gitops::open_in_editor,
            gitops::editor_available,
            gitops::gh_available,
            gitops::git_repo_config,
            projects::projects_list,
            projects::project_add,
            projects::project_create,
            projects::project_clone,
            projects::project_remove,
            projects::project_style,
            versions::tools_versions,
            files::file_read,
            files::file_write,
            files::file_mtime,
            files::file_bytes,
            files::file_reveal,
            files::paths_kind,
            files::folder_open,
            work::work_config_get,
            work::work_config_set,
            work::work_detect,
            work::work_github_login,
            work::work_github_logout,
            work::work_ado_login,
            work::work_ado_logout,
            work::local::work_local,
            work::github::work_github,
            work::github::work_github_thread,
            work::github::work_github_comment,
            work::github::work_github_set_state,
            work::ado::work_ado_set_state,
            work::ado::work_ado,
            work::ado::work_ado_thread,
            work::ado::work_ado_comment,
            work::ado::work_ado_discover,
            work::ado::work_ado_pat_set,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = app.state::<SettingsState>().get();
            settings::apply_theme(&handle, &settings.theme);
            // Reaplica a inicialização com o Windows (ex.: após instalar ou mover o app).
            if settings.onboarded {
                if let Err(e) = settings::sync_autostart(&handle, settings.autostart) {
                    log::warn!("{e}");
                }
                if let Err(e) = explorer::sync_menu(settings.explorer_menu) {
                    log::warn!("menu do Explorer: {e}");
                }
            }
            app.state::<Registry>()
                .boot(&handle, settings.onboarded && settings.auto_resume);
            // Reabre todas as janelas que estavam abertas, cada uma no seu monitor.
            windows::restore(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let reg = app.state::<Registry>();
            match event {
                // O pedido de fechar pode ser cancelado pela proteção de chats em
                // andamento; por isso o encerramento só é marcado na destruição.
                WindowEvent::CloseRequested { .. } if window.label() != windows::MAIN => {
                    reg.mark_user_closing(window.label())
                }
                // Fechar a principal encerra o Polvo; as outras janelas ficam
                // lembradas e reabrem na próxima vez.
                WindowEvent::Destroyed if window.label() == windows::MAIN => {
                    reg.mark_exiting();
                    app.exit(0)
                }
                // Fechar uma janela extra devolve as sessões dela à principal.
                WindowEvent::Destroyed => reg.window_closed(app, window.label()),
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Polvo");

    app.run(|app, event| {
        match event {
            // Encerramento por qualquer motivo (atualização, desligar o Windows…):
            // as janelas abertas continuam lembradas.
            RunEvent::ExitRequested { .. } => app.state::<Registry>().mark_exiting(),
            RunEvent::Exit => app.state::<PtyManager>().kill_all(),
            _ => {}
        }
    });
}
