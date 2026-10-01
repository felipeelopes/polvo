//! Descobre os ids de sessão gravados por cada CLI, para poder retomá-los.
//!
//! - Claude Code: `~/.claude/projects/<pasta-codificada>/<id>.jsonl`
//! - Codex CLI:   `~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl` (1ª linha = `session_meta`)
//! - OpenCode:    `opencode session list --format json` executado na pasta

use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use serde_json::Value;

use crate::paths::{self, same_path};

// ---------------------------------------------------------------- Claude Code

pub fn claude_dir() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| paths::home().join(".claude"))
}

/// O Claude Code troca todo caractere não alfanumérico da pasta por `-`.
fn claude_project_dir(cwd: &Path) -> PathBuf {
    let encoded: String = cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    claude_dir().join("projects").join(encoded)
}

pub fn claude_session_exists(id: &str) -> bool {
    let file = format!("{id}.jsonl");
    fs::read_dir(claude_dir().join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .any(|e| e.path().join(&file).is_file())
}

pub fn claude_latest(cwd: &Path) -> Option<String> {
    newest_file(&claude_project_dir(cwd), "jsonl")
        .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned()))
}

/// Comando de statusline configurado pelo usuário em `~/.claude/settings.json`.
pub fn claude_user_statusline() -> Option<String> {
    let bytes = fs::read(claude_dir().join("settings.json")).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v.pointer("/statusLine/command")?
        .as_str()
        .map(str::to_string)
}

// ---------------------------------------------------------------- Codex CLI

fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| paths::home().join(".codex"))
}

/// Arquivos de sessão dos últimos `days` dias com atividade, do mais novo ao mais antigo.
pub fn codex_rollouts(days: usize) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut seen = 0;
    'outer: for year in dirs_desc(&codex_home().join("sessions")) {
        for month in dirs_desc(&year) {
            for day in dirs_desc(&month) {
                if seen >= days {
                    break 'outer;
                }
                seen += 1;
                files.extend(files_with_ext(&day, "jsonl"));
            }
        }
    }
    files.sort_by_key(|p| std::cmp::Reverse(modified(p)));
    files
}

struct CodexMeta {
    id: String,
    cwd: String,
}

fn codex_meta(path: &Path) -> Option<CodexMeta> {
    let mut line = String::new();
    BufReader::new(fs::File::open(path).ok()?)
        .read_line(&mut line)
        .ok()?;
    let v: Value = serde_json::from_str(&line).ok()?;
    if v.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let p = v.get("payload")?;
    Some(CodexMeta {
        id: p.get("id")?.as_str()?.to_string(),
        cwd: p.get("cwd")?.as_str()?.to_string(),
    })
}

pub fn codex_latest(cwd: &Path) -> Option<String> {
    let cwd = cwd.to_string_lossy();
    codex_rollouts(14)
        .iter()
        .filter_map(|f| codex_meta(f))
        .find(|m| same_path(&m.cwd, &cwd))
        .map(|m| m.id)
}

/// Sessão do Codex criada nesta pasta depois de `since` e ainda sem dono.
pub fn codex_discover(cwd: &Path, since: SystemTime, claimed: &HashSet<String>) -> Option<String> {
    let cwd = cwd.to_string_lossy();
    let since = since - Duration::from_secs(5);
    let mut found: Vec<(SystemTime, String)> = codex_rollouts(2)
        .iter()
        .filter(|f| created(f) >= since)
        .filter_map(|f| codex_meta(f).map(|m| (created(f), m)))
        .filter(|(_, m)| same_path(&m.cwd, &cwd) && !claimed.contains(&m.id))
        .map(|(t, m)| (t, m.id))
        .collect();
    found.sort();
    found.into_iter().next().map(|(_, id)| id)
}

// ---------------------------------------------------------------- OpenCode

struct OcSession {
    id: String,
    created: i64,
    updated: i64,
    directory: String,
}

fn opencode_list(cwd: &Path) -> Vec<OcSession> {
    let Some(program) = crate::tools::resolve("opencode") else {
        return vec![];
    };
    let mut cmd = Command::new(&program.path);
    cmd.args(&program.prefix)
        .args(["session", "list", "--format", "json", "-n", "20"])
        .current_dir(cwd);
    hide_console(&mut cmd);
    let Ok(out) = cmd.output() else { return vec![] };
    let Ok(items) = serde_json::from_slice::<Vec<Value>>(&out.stdout) else {
        return vec![];
    };
    items
        .iter()
        .filter_map(|v| {
            Some(OcSession {
                id: v.get("id")?.as_str()?.to_string(),
                created: v.get("created").and_then(Value::as_i64).unwrap_or(0),
                updated: v.get("updated").and_then(Value::as_i64).unwrap_or(0),
                directory: v
                    .get("directory")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect()
}

pub fn opencode_latest(cwd: &Path) -> Option<String> {
    let dir = cwd.to_string_lossy();
    opencode_list(cwd)
        .into_iter()
        .filter(|s| same_path(&s.directory, &dir))
        .max_by_key(|s| s.updated)
        .map(|s| s.id)
}

pub fn opencode_discover(cwd: &Path, since_ms: i64, claimed: &HashSet<String>) -> Option<String> {
    let dir = cwd.to_string_lossy();
    opencode_list(cwd)
        .into_iter()
        .filter(|s| {
            s.created >= since_ms - 5_000
                && same_path(&s.directory, &dir)
                && !claimed.contains(&s.id)
        })
        .min_by_key(|s| s.created)
        .map(|s| s.id)
}

// ---------------------------------------------------------------- utilitários

pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

fn dirs_desc(path: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    v.sort_by(|a, b| b.cmp(a));
    v
}

fn files_with_ext(dir: &Path, ext: &str) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)))
        .collect()
}

fn newest_file(dir: &Path, ext: &str) -> Option<PathBuf> {
    files_with_ext(dir, ext)
        .into_iter()
        .max_by_key(|p| modified(p))
}

pub fn modified(p: &Path) -> SystemTime {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn created(p: &Path) -> SystemTime {
    fs::metadata(p)
        .and_then(|m| m.created().or_else(|_| m.modified()))
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_encodes_project_dir_like_the_cli() {
        let dir = claude_project_dir(Path::new(r"D:\Projetos\SplitAITerminal"));
        assert!(dir.ends_with("D--Projetos-SplitAITerminal"));
    }
}
