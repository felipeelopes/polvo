//! Arquivos abertos no visualizador de Markdown: ler, gravar, acompanhar
//! mudanças feitas por fora (pelo agente, por exemplo) e carregar imagens.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::ipc::Response;

use crate::error::{AppError, AppResult};

/// Documentos maiores que isso não são abertos (o editor travaria).
const MAX_TEXT: u64 = 8 * 1024 * 1024;
/// Limite para imagens embutidas nos documentos.
const MAX_BYTES: u64 = 40 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDoc {
    path: String,
    content: String,
    mtime: u64,
}

fn mtime_of(path: &Path) -> AppResult<u64> {
    let modified = std::fs::metadata(path)?.modified()?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0))
}

/// Caminho absoluto e sem `..`, mantendo o formato que o usuário reconhece
/// (sem o prefixo `\\?\` que `canonicalize` coloca no Windows).
fn absolute(path: &str) -> AppResult<PathBuf> {
    let p = std::path::absolute(path.trim())?;
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other),
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn file_read(path: String) -> AppResult<FileDoc> {
    let p = absolute(&path)?;
    let meta = std::fs::metadata(&p).map_err(|_| {
        AppError::msg(crate::i18n::tr(
            "files.notFound",
            &[("path", &p.display().to_string())],
        ))
    })?;
    if !meta.is_file() {
        return Err(AppError::msg(crate::i18n::tr("files.notAFile", &[])));
    }
    if meta.len() > MAX_TEXT {
        return Err(AppError::msg(crate::i18n::tr(
            "files.tooLargeForEditor",
            &[],
        )));
    }
    let bytes = std::fs::read(&p)?;
    let content =
        String::from_utf8_lossy(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes)).into_owned();
    Ok(FileDoc {
        mtime: mtime_of(&p)?,
        path: p.to_string_lossy().into_owned(),
        content,
    })
}

/// Grava o documento e devolve a nova data de modificação.
#[tauri::command]
pub fn file_write(path: String, content: String) -> AppResult<u64> {
    let p = absolute(&path)?;
    std::fs::write(&p, content)?;
    mtime_of(&p)
}

/// Data de modificação (ms) ou `None` se o arquivo sumiu.
#[tauri::command]
pub fn file_mtime(path: String) -> Option<u64> {
    mtime_of(&absolute(&path).ok()?).ok()
}

/// Tipo de cada caminho (para links no terminal): 0 não existe, 1 arquivo, 2 pasta.
#[tauri::command]
pub fn paths_kind(paths: Vec<String>) -> Vec<u8> {
    paths
        .iter()
        .map(
            |p| match absolute(p).and_then(|p| Ok(std::fs::metadata(p)?)) {
                Ok(m) if m.is_dir() => 2,
                Ok(m) if m.is_file() => 1,
                _ => 0,
            },
        )
        .collect()
}

/// Extensões que o Windows executaria em vez de abrir: só mostramos no Explorer.
const RUNNABLE: &[&str] = &[
    "exe",
    "com",
    "bat",
    "cmd",
    "ps1",
    "psm1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "msi",
    "msp",
    "scr",
    "lnk",
    "url",
    "reg",
    "hta",
    "cpl",
    "msc",
    "pif",
    "jar",
    "appref-ms",
    "application",
];

/// É um arquivo que o Windows executaria ao abrir?
fn is_runnable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| RUNNABLE.contains(&e.to_ascii_lowercase().as_str()))
}

/// Abre a pasta no Explorer ou o arquivo no programa padrão. Executáveis e
/// scripts não rodam: são só selecionados no Explorer (devolve `false`).
#[tauri::command]
pub fn file_open(path: String) -> AppResult<bool> {
    let p = absolute(&path)?;
    let meta = std::fs::metadata(&p)?;
    if meta.is_file() && is_runnable(&p) {
        file_reveal(path)?;
        return Ok(false);
    }
    std::process::Command::new("explorer").arg(&p).spawn()?;
    Ok(true)
}

/// Conteúdo binário (imagens referenciadas pelo Markdown).
#[tauri::command]
pub fn file_bytes(path: String) -> AppResult<Response> {
    let p = absolute(&path)?;
    if std::fs::metadata(&p)?.len() > MAX_BYTES {
        return Err(AppError::msg(crate::i18n::tr("files.tooLarge", &[])));
    }
    Ok(Response::new(std::fs::read(&p)?))
}

/// Mostra o arquivo selecionado no Explorer.
#[tauri::command]
pub fn file_reveal(path: String) -> AppResult<()> {
    let p = absolute(&path)?;
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", p.display()))
        .spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{absolute, is_runnable};
    use std::path::Path;

    #[test]
    fn blocks_runnable_files() {
        assert!(is_runnable(Path::new(r"C:\x\setup.EXE")));
        assert!(is_runnable(Path::new("build.ps1")));
        assert!(!is_runnable(Path::new("foto.png")));
        assert!(!is_runnable(Path::new("Makefile")));
    }

    #[cfg(windows)]
    #[test]
    fn resolves_parent_dirs() {
        let p = absolute(r"C:\a\b\..\c\.\d.md").unwrap();
        assert_eq!(p.to_string_lossy(), r"C:\a\c\d.md");
    }
}
