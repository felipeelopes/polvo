//! "Abrir no Polvo" no menu do Explorer (Shift + clique direito numa pasta).
//!
//! As entradas ficam em `HKCU\Software\Classes` (sem precisar de administrador)
//! e são reaplicadas a cada início, para apontar sempre para o executável atual.
//! O valor `Extended` faz o item aparecer só com Shift pressionado.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::AppResult;

pub const OPEN_FLAG: &str = "--open";
pub const EVT_OPEN_FOLDER: &str = "open-folder";

/// Pastas recebidas por linha de comando antes de a janela estar pronta.
#[derive(Default)]
pub struct PendingOpen(pub Mutex<Option<String>>);

/// Procura `--open <pasta>` nos argumentos.
pub fn folder_from_args<S: AsRef<str>>(args: &[S]) -> Option<String> {
    let i = args.iter().position(|a| a.as_ref() == OPEN_FLAG)?;
    let path = args
        .get(i + 1)?
        .as_ref()
        .trim()
        .trim_matches('"')
        .to_string();
    (!path.is_empty()).then_some(path)
}

/// Uma segunda execução (vinda do Explorer) entrega a pasta à janela principal.
pub fn deliver(app: &AppHandle, folder: String) {
    if let Some(w) = app.get_webview_window(crate::windows::MAIN) {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let _ = app.emit(EVT_OPEN_FOLDER, folder);
}

/// A janela, ao terminar de carregar, pega a pasta pedida na abertura do app.
#[tauri::command]
pub fn open_folder_take(pending: State<PendingOpen>) -> Option<String> {
    pending.0.lock().ok()?.take()
}

const KEYS: [&str; 3] = [
    r"Software\Classes\Directory\shell\Polvo",
    r"Software\Classes\Directory\Background\shell\Polvo",
    r"Software\Classes\Drive\shell\Polvo",
];

/// Liga ou desliga o item no menu do Explorer.
pub fn sync_menu(enabled: bool) -> AppResult<()> {
    // O executável de desenvolvimento depende do servidor do Vite.
    if cfg!(debug_assertions) {
        return Ok(());
    }
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if !enabled {
            for key in KEYS {
                let _ = hkcu.delete_subkey_all(key);
            }
            return Ok(());
        }
        let exe = std::env::current_exe()?.to_string_lossy().into_owned();
        for key in KEYS {
            let (k, _) = hkcu.create_subkey(key)?;
            k.set_value("", &"Abrir no Polvo")?;
            k.set_value("Icon", &format!("\"{exe}\",0"))?;
            k.set_value("Extended", &"")?;
            let (cmd, _) = k.create_subkey("command")?;
            cmd.set_value("", &format!("\"{exe}\" {OPEN_FLAG} \"%V\""))?;
        }
    }
    #[cfg(not(windows))]
    let _ = enabled;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::folder_from_args;

    #[test]
    fn reads_folder_from_args() {
        assert_eq!(
            folder_from_args(&["polvo.exe", "--open", r"D:\Projetos\api"]).as_deref(),
            Some(r"D:\Projetos\api")
        );
        assert_eq!(folder_from_args(&["polvo.exe"]), None);
        assert_eq!(folder_from_args(&["polvo.exe", "--open"]), None);
    }
}
