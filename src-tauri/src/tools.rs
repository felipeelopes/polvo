//! Perfis das ferramentas suportadas e como iniciá-las ou retomá-las.
//!
//! | Ferramenta  | Nova sessão                | Retomar                   |
//! |-------------|----------------------------|---------------------------|
//! | Claude Code | `claude --session-id <id>` | `claude --resume <id>`    |
//! | Codex CLI   | `codex` (id descoberto)    | `codex resume <id>`       |
//! | OpenCode    | `opencode` (id descoberto) | `opencode --session <id>` |
//! | Shell       | `pwsh` / `powershell`      | abre na mesma pasta       |

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::discovery;
use crate::error::{AppError, AppResult};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ToolKind {
    Claude,
    Codex,
    Opencode,
    Shell,
}

impl ToolKind {
    pub const ALL: [ToolKind; 4] = [
        ToolKind::Claude,
        ToolKind::Codex,
        ToolKind::Opencode,
        ToolKind::Shell,
    ];

    pub fn label(self) -> &'static str {
        match self {
            ToolKind::Claude => "Claude Code",
            ToolKind::Codex => "Codex CLI",
            ToolKind::Opencode => "OpenCode",
            ToolKind::Shell => "PowerShell",
        }
    }

    fn binary(self) -> &'static str {
        match self {
            ToolKind::Claude => "claude",
            ToolKind::Codex => "codex",
            ToolKind::Opencode => "opencode",
            ToolKind::Shell => "pwsh",
        }
    }
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StartMode {
    /// Sessão nova.
    New,
    /// Retomar a sessão conhecida (`session_id`).
    Resume,
    /// Retomar a sessão mais recente da pasta.
    Continue,
}

/// Executável resolvido. Scripts `.cmd` (comum em instalações via npm) são
/// executados através do `cmd.exe /d /c`.
#[derive(Clone, Debug)]
pub struct Program {
    pub path: PathBuf,
    pub prefix: Vec<String>,
}

pub fn resolve(name: &str) -> Option<Program> {
    let found = which::which(name).ok()?;
    let ext = found
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "cmd" || ext == "bat" {
        let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        Some(Program {
            path: comspec.into(),
            prefix: vec![
                "/d".into(),
                "/c".into(),
                found.to_string_lossy().into_owned(),
            ],
        })
    } else {
        Some(Program {
            path: found,
            prefix: vec![],
        })
    }
}

fn resolve_tool(tool: ToolKind) -> Option<Program> {
    match tool {
        ToolKind::Shell => resolve("pwsh")
            .or_else(|| resolve("powershell"))
            .map(|mut p| {
                p.prefix.push("-NoLogo".into());
                p
            }),
        t => resolve(t.binary()),
    }
}

#[tauri::command]
pub fn tools_available() -> HashMap<ToolKind, bool> {
    ToolKind::ALL
        .iter()
        .map(|t| (*t, resolve_tool(*t).is_some()))
        .collect()
}

/// Ajustes extras na linha de comando do Claude Code.
#[derive(Default)]
pub struct PlanOptions {
    /// Arquivo de settings com a ponte de statusline (`--settings <arquivo>`).
    pub claude_settings: Option<PathBuf>,
    /// Comando de statusline do próprio usuário, repassado pela ponte.
    pub user_statusline: Option<String>,
    /// Pular as confirmações de permissão do Claude Code.
    pub claude_bypass: bool,
}

/// Como iniciar um processo e o que já se sabe sobre a sessão.
#[derive(Debug)]
pub struct LaunchPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// Id da sessão do CLI, quando já é conhecido antes de iniciar.
    pub session_id: Option<String>,
    /// O id só aparece depois que o CLI cria a sessão; precisa ser descoberto.
    pub discover: bool,
}

pub fn plan(
    tool: ToolKind,
    mode: StartMode,
    known: Option<&str>,
    cwd: &Path,
    opts: &PlanOptions,
) -> AppResult<LaunchPlan> {
    let program = resolve_tool(tool).ok_or_else(|| {
        AppError::msg(crate::i18n::tr("tools.notFound", &[("tool", tool.label())]))
    })?;
    let mut args = program.prefix.clone();
    let mut env = Vec::new();
    let mut session_id = None;
    let mut discover = false;

    match tool {
        ToolKind::Claude => {
            let resume_id = match (mode, known) {
                (StartMode::Resume, Some(id)) => Some(id.to_string()),
                (StartMode::Continue, _) => discovery::claude_latest(cwd),
                _ => None,
            };
            match resume_id {
                // Só dá para retomar se o Claude chegou a gravar a conversa.
                Some(id) if discovery::claude_session_exists(&id) => {
                    args.extend(["--resume".into(), id.clone()]);
                    session_id = Some(id);
                }
                other => {
                    let id = other.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                    args.extend(["--session-id".into(), id.clone()]);
                    session_id = Some(id);
                }
            }
            if opts.claude_bypass {
                args.extend(["--permission-mode".into(), "bypassPermissions".into()]);
            }
            if let Some(file) = &opts.claude_settings {
                args.extend(["--settings".into(), file.to_string_lossy().into_owned()]);
                if let Some(cmd) = &opts.user_statusline {
                    env.push((crate::bridge::USER_STATUSLINE_ENV.into(), cmd.clone()));
                }
            }
        }
        ToolKind::Codex => {
            let id = match (mode, known) {
                (StartMode::Resume, Some(id)) => Some(id.to_string()),
                (StartMode::Continue, _) => discovery::codex_latest(cwd),
                _ => None,
            };
            match id {
                Some(id) => {
                    args.extend(["resume".into(), id.clone()]);
                    session_id = Some(id);
                }
                None => discover = true,
            }
        }
        ToolKind::Opencode => {
            let id = match (mode, known) {
                (StartMode::Resume, Some(id)) => Some(id.to_string()),
                (StartMode::Continue, _) => discovery::opencode_latest(cwd),
                _ => None,
            };
            match id {
                Some(id) => {
                    args.extend(["--session".into(), id.clone()]);
                    session_id = Some(id);
                }
                None => discover = true,
            }
        }
        ToolKind::Shell => {}
    }

    Ok(LaunchPlan {
        program: program.path,
        args,
        env,
        session_id,
        discover,
    })
}
