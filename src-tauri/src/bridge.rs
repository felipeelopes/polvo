//! Ponte de statusline do Claude Code.
//!
//! O Claude Code envia um JSON para o comando de statusline a cada atualização.
//! Para assinantes Pro/Max esse JSON traz `rate_limits.five_hour` e
//! `rate_limits.seven_day`. O Polvo inicia o Claude com
//! `--settings <arquivo>`, apontando a statusline para o próprio executável
//! (`polvo.exe --statusline-bridge`), que:
//!   1. grava os limites em `%APPDATA%\Polvo\usage\claude.json`;
//!   2. repassa o JSON para a statusline que o usuário já tinha e imprime a
//!      saída dela, para não mudar nada na aparência do Claude.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

use crate::error::AppResult;
use crate::paths;

pub const BRIDGE_FLAG: &str = "--statusline-bridge";
pub const USER_STATUSLINE_ENV: &str = "POLVO_USER_STATUSLINE";

/// Arquivo de settings passado ao Claude Code com `--settings`.
pub fn claude_settings_file() -> AppResult<PathBuf> {
    let exe = std::env::current_exe()?
        .to_string_lossy()
        .replace('\\', "/");
    let settings = json!({
        "statusLine": { "type": "command", "command": format!("\"{exe}\" {BRIDGE_FLAG}"), "padding": 0 }
    });
    let file = paths::data_dir().join("claude-statusline.json");
    paths::write_atomic(&file, &serde_json::to_vec_pretty(&settings)?)?;
    Ok(file)
}

/// Executado quando o processo é iniciado com `--statusline-bridge`.
pub fn run() -> i32 {
    let mut input = String::new();
    let _ = std::io::stdin()
        .take(4 * 1024 * 1024)
        .read_to_string(&mut input);
    let parsed: Value = serde_json::from_str(&input).unwrap_or(Value::Null);

    if let Some(limits) = parsed.get("rate_limits").filter(|v| v.is_object()) {
        let snapshot = json!({
            "fiveHour": limits.get("five_hour"),
            "sevenDay": limits.get("seven_day"),
            "observedAt": paths::now_ms(),
            "sessionId": parsed.get("session_id"),
        });
        if let Ok(bytes) = serde_json::to_vec(&snapshot) {
            let _ = paths::write_atomic(&paths::usage_dir().join("claude.json"), &bytes);
        }
    }

    let line = match std::env::var(USER_STATUSLINE_ENV)
        .ok()
        .filter(|c| !c.trim().is_empty())
    {
        Some(cmd) => run_user_statusline(&cmd, &input).unwrap_or_default(),
        None => default_line(&parsed),
    };
    let mut out = std::io::stdout();
    let _ = out.write_all(line.as_bytes());
    let _ = out.flush();
    0
}

fn default_line(v: &Value) -> String {
    let model = v
        .pointer("/model/display_name")
        .and_then(Value::as_str)
        .unwrap_or("Claude");
    let dir = v
        .pointer("/workspace/current_dir")
        .or_else(|| v.get("cwd"))
        .and_then(Value::as_str)
        .and_then(|d| d.rsplit(['\\', '/']).next())
        .unwrap_or("");
    format!("{model} · {dir}")
}

/// Executa a statusline original do usuário. O Claude Code no Windows roda
/// esses comandos pelo Git Bash quando disponível; fazemos o mesmo.
fn run_user_statusline(cmd: &str, input: &str) -> Option<String> {
    let bash = std::env::var("CLAUDE_CODE_GIT_BASH_PATH")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .or_else(|| {
            [
                "C:\\Program Files\\Git\\bin\\bash.exe",
                "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
            ]
            .iter()
            .map(PathBuf::from)
            .find(|p| p.is_file())
        });
    let mut command = match bash {
        Some(b) => {
            let mut c = Command::new(b);
            c.args(["-c", cmd]);
            c
        }
        None => {
            let mut c = Command::new(std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into()));
            c.args(["/d", "/s", "/c", cmd]);
            c
        }
    };
    crate::discovery::hide_console(&mut command);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    child.stdin.take()?.write_all(input.as_bytes()).ok()?;
    let out = child.wait_with_output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}
