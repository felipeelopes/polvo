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

/// Quais destes caminhos são arquivos existentes (para sublinhar links no terminal).
#[tauri::command]
pub fn files_exist(paths: Vec<String>) -> Vec<bool> {
    paths
        .iter()
        .map(|p| absolute(p).map(|p| p.is_file()).unwrap_or(false))
        .collect()
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
    use super::absolute;

    #[cfg(windows)]
    #[test]
    fn resolves_parent_dirs() {
        let p = absolute(r"C:\a\b\..\c\.\d.md").unwrap();
        assert_eq!(p.to_string_lossy(), r"C:\a\c\d.md");
    }
}
