//! Versões dos CLIs: a instalada (`<cli> --version`), a mais recente publicada
//! (npm) e o comando que atualiza cada um. Sessões guardam a versão com que
//! foram iniciadas; quando ela difere da instalada, dá para reiniciá-las.

use std::collections::HashMap;
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;

use crate::discovery::hide_console;
use crate::tools::{self, ToolKind};

const INSTALLED_TTL: Duration = Duration::from_secs(60);
const LATEST_TTL: Duration = Duration::from_secs(6 * 60 * 60);

type Cache = Mutex<HashMap<String, (Instant, Option<String>)>>;

fn cache() -> &'static Cache {
    static C: OnceLock<Cache> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn cached(key: String, ttl: Duration, f: impl FnOnce() -> Option<String>) -> Option<String> {
    if let Some((at, v)) = cache().lock().get(&key) {
        if at.elapsed() < ttl {
            return v.clone();
        }
    }
    let v = f();
    cache().lock().insert(key, (Instant::now(), v.clone()));
    v
}

/// Primeiro "x.y.z" de um texto (ex.: "2.1.287 (Claude Code)").
pub fn parse_version(text: &str) -> Option<String> {
    text.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|t| t.matches('.').count() >= 2 && t.split('.').all(|p| !p.is_empty()))
        .map(str::to_string)
}

fn run(program: &tools::Program, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(&program.path);
    cmd.args(&program.prefix).args(args);
    hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Versão instalada (com cache curto).
pub fn installed(tool: ToolKind) -> Option<String> {
    if tool == ToolKind::Shell {
        return None;
    }
    cached(format!("installed:{tool:?}"), INSTALLED_TTL, || {
        let program = tools::resolve(tool_binary(tool))?;
        parse_version(&run(&program, &["--version"])?)
    })
}

fn tool_binary(tool: ToolKind) -> &'static str {
    match tool {
        ToolKind::Claude => "claude",
        ToolKind::Codex => "codex",
        ToolKind::Opencode => "opencode",
        ToolKind::Shell => "pwsh",
    }
}

fn npm_package(tool: ToolKind) -> Option<&'static str> {
    match tool {
        ToolKind::Claude => Some("@anthropic-ai/claude-code"),
        ToolKind::Codex => Some("@openai/codex"),
        ToolKind::Opencode => Some("opencode-ai"),
        ToolKind::Shell => None,
    }
}

/// Versão mais recente publicada no npm (com cache longo).
fn latest(tool: ToolKind) -> Option<String> {
    let package = npm_package(tool)?;
    cached(format!("latest:{tool:?}"), LATEST_TTL, || {
        let npm = tools::resolve("npm")?;
        parse_version(&run(&npm, &["view", package, "version"])?)
    })
}

/// Comando que atualiza o CLI, de acordo com a forma como foi instalado.
fn update_command(tool: ToolKind) -> Option<String> {
    let path = which::which(tool_binary(tool)).ok()?;
    let p = path.to_string_lossy().to_lowercase();
    let via_npm = p.contains("\\npm\\") || p.contains("node_modules");
    Some(match tool {
        ToolKind::Claude => "claude update".into(),
        ToolKind::Codex if via_npm => "npm install -g @openai/codex@latest".into(),
        ToolKind::Codex => {
            "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex".into()
        }
        ToolKind::Opencode => "opencode upgrade".into(),
        ToolKind::Shell => return None,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolVersion {
    installed: Option<String>,
    latest: Option<String>,
    update_command: Option<String>,
}

/// Versões instalada e publicada de cada CLI, e como atualizá-lo.
#[tauri::command]
pub async fn tools_versions() -> HashMap<ToolKind, ToolVersion> {
    tauri::async_runtime::spawn_blocking(|| {
        [ToolKind::Claude, ToolKind::Codex, ToolKind::Opencode]
            .into_iter()
            .filter(|t| tools::resolve(tool_binary(*t)).is_some())
            .map(|t| {
                (
                    t,
                    ToolVersion {
                        installed: installed(t),
                        latest: latest(t),
                        update_command: update_command(t),
                    },
                )
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn parses_cli_versions() {
        assert_eq!(
            parse_version("2.1.287 (Claude Code)").as_deref(),
            Some("2.1.287")
        );
        assert_eq!(
            parse_version("codex-cli 0.159.1").as_deref(),
            Some("0.159.1")
        );
        assert_eq!(parse_version("1.18.34\n").as_deref(), Some("1.18.34"));
        assert_eq!(parse_version("sem versão"), None);
    }
}
