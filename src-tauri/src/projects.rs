//! Projetos: pastas que aparecem na barra lateral mesmo sem sessões abertas
//! (como no Codex e no Claude Code). Dá para abrir uma pasta existente, criar
//! uma nova (com `git init` opcional) ou clonar um repositório.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::discovery::hide_console;
use crate::error::{AppError, AppResult};
use crate::registry::Registry;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub added_at: i64,
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn git(dir: &Path, args: &[&str]) -> AppResult<()> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    hide_console(&mut cmd);
    let out = cmd
        .output()
        .map_err(|_| AppError::msg(crate::i18n::tr("projects.gitNotFound", &[])))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(AppError::msg(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ))
    }
}

#[tauri::command]
pub fn projects_list(reg: State<Registry>) -> Vec<ProjectRecord> {
    reg.projects()
}

/// Abre (adiciona à barra lateral) uma pasta existente.
#[tauri::command]
pub fn project_add(app: AppHandle, reg: State<Registry>, path: String) -> AppResult<ProjectRecord> {
    let p = PathBuf::from(path.trim());
    if !p.is_dir() {
        return Err(AppError::msg(crate::i18n::tr(
            "projects.folderMustExist",
            &[],
        )));
    }
    Ok(reg.add_project(&app, &p.to_string_lossy(), &name_of(&p)))
}

/// Cria uma pasta nova para o projeto, opcionalmente com `git init`.
#[tauri::command]
pub async fn project_create(
    app: AppHandle,
    reg: State<'_, Registry>,
    parent: String,
    name: String,
    git_init: bool,
) -> AppResult<ProjectRecord> {
    let name = name.trim();
    if name.is_empty() || name.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
        return Err(AppError::msg(crate::i18n::tr("projects.invalidName", &[])));
    }
    let parent = PathBuf::from(parent.trim());
    if !parent.is_dir() {
        return Err(AppError::msg(crate::i18n::tr(
            "projects.parentMissing",
            &[],
        )));
    }
    let dir = parent.join(name);
    if dir.exists() {
        return Err(AppError::msg(crate::i18n::tr(
            "projects.folderExists",
            &[("name", name)],
        )));
    }
    std::fs::create_dir_all(&dir)?;
    if git_init {
        git(&dir, &["init", "-q"])?;
    }
    Ok(reg.add_project(&app, &dir.to_string_lossy(), name))
}

/// Clona um repositório git numa pasta e o adiciona como projeto.
#[tauri::command]
pub async fn project_clone(
    app: AppHandle,
    reg: State<'_, Registry>,
    url: String,
    parent: String,
) -> AppResult<ProjectRecord> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err(AppError::msg(crate::i18n::tr("projects.urlRequired", &[])));
    }
    let parent = PathBuf::from(parent.trim());
    if !parent.is_dir() {
        return Err(AppError::msg(crate::i18n::tr(
            "projects.destinationMissing",
            &[],
        )));
    }
    let name = url
        .trim_end_matches('/')
        .rsplit(['/', ':'])
        .next()
        .unwrap_or("repositorio")
        .trim_end_matches(".git")
        .to_string();
    let dir = parent.join(&name);
    if dir.exists() {
        return Err(AppError::msg(crate::i18n::tr(
            "projects.folderExists",
            &[("name", &name)],
        )));
    }
    let target = dir.to_string_lossy().into_owned();
    let p = parent.clone();
    tauri::async_runtime::spawn_blocking(move || git(&p, &["clone", "-q", &url, &target]))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    Ok(reg.add_project(&app, &dir.to_string_lossy(), &name))
}

/// Tira o projeto da barra lateral (não apaga nada do disco).
#[tauri::command]
pub fn project_remove(app: AppHandle, reg: State<Registry>, path: String) {
    reg.remove_project(&app, &path);
}
