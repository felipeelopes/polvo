//! Informações de git de cada pasta de sessão, para agrupar a barra lateral
//! por projeto (repositório) e mostrar os worktrees de cada um.

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;

use crate::discovery::hide_console;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    /// Worktree principal (a pasta original do repositório).
    pub main: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Raiz do worktree onde a pasta está.
    pub root: String,
    /// Identifica o projeto: todos os worktrees de um repositório têm o mesmo.
    pub project: String,
    pub branch: Option<String>,
    pub worktrees: Vec<Worktree>,
}

const TTL: Duration = Duration::from_secs(20);

/// Resultado guardado por pasta, com o momento da leitura.
type Cache = Mutex<HashMap<String, (Instant, Option<RepoInfo>)>>;

fn cache() -> &'static Cache {
    static C: OnceLock<Cache> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// `C:/x/y` (como o git devolve) → `C:\x\y`.
fn win_path(p: &str) -> String {
    p.replace('/', "\\")
}

fn worktrees(root: &Path) -> Vec<Worktree> {
    let Some(out) = git(root, &["worktree", "list", "--porcelain"]) else {
        return vec![];
    };
    let mut list = Vec::new();
    for block in out.split("\n\n") {
        let mut path = None;
        let mut branch = None;
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(win_path(p));
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(b.trim_start_matches("refs/heads/").to_string());
            } else if line == "detached" {
                branch = Some("(detached)".into());
            }
        }
        if let Some(path) = path {
            list.push(Worktree {
                main: list.is_empty(),
                path,
                branch,
            });
        }
    }
    list
}

fn read(dir: &str) -> Option<RepoInfo> {
    let path = Path::new(dir);
    let root = win_path(&git(path, &["rev-parse", "--show-toplevel"])?);
    let branch = git(path, &["branch", "--show-current"]).filter(|b| !b.is_empty());
    let worktrees = worktrees(Path::new(&root));
    let project = worktrees
        .iter()
        .find(|w| w.main)
        .map(|w| w.path.clone())
        .unwrap_or_else(|| root.clone());
    Some(RepoInfo {
        root,
        project,
        branch,
        worktrees,
    })
}

fn info(dir: &str) -> Option<RepoInfo> {
    if let Some((at, v)) = cache().lock().get(dir) {
        if at.elapsed() < TTL {
            return v.clone();
        }
    }
    let v = read(dir);
    cache()
        .lock()
        .insert(dir.to_string(), (Instant::now(), v.clone()));
    v
}

/// Repositório, branch e worktrees de cada pasta (`null` se não for git).
#[tauri::command]
pub async fn git_info(paths: Vec<String>) -> HashMap<String, Option<RepoInfo>> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|p| {
                let v = info(&p);
                (p, v)
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}
