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
/// Id da sessão do Polvo, herdado pelo Claude e pela statusline.
pub const POLVO_SESSION_ENV: &str = "POLVO_SESSION";

/// Arquivo com a conversa que uma sessão do Polvo está mostrando agora. Muda
/// quando o usuário troca de conversa dentro do Claude (`/resume`, `/clear`).
pub fn active_conversation_file(polvo_id: &str) -> PathBuf {
    paths::usage_dir()
        .join("active")
        .join(format!("{polvo_id}.json"))
}

/// Conversa atual de uma sessão do Polvo, segundo a última statusline.
pub fn active_conversation(polvo_id: &str) -> Option<String> {
    let bytes = std::fs::read(active_conversation_file(polvo_id)).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v.get("sessionId")?.as_str().map(str::to_string)
}

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

    // Dados por sessão: contexto (quando o Claude informa) e o modelo, que
    // ajuda a saber o tamanho da janela de contexto (200 mil ou 1 milhão).
    if let Some(sid) = parsed.get("session_id").and_then(Value::as_str) {
        let snapshot = json!({
            "contextPercent": context_percent(&parsed),
            "modelId": parsed.pointer("/model/id"),
            "exceeds200k": parsed.get("exceeds_200k_tokens"),
            "observedAt": paths::now_ms(),
        });
        if let Ok(bytes) = serde_json::to_vec(&snapshot) {
            let dir = paths::usage_dir().join("sessions");
            let _ = std::fs::create_dir_all(&dir);
            let _ = paths::write_atomic(&dir.join(format!("{sid}.json")), &bytes);
        }
    }

    // Qual conversa esta sessão do Polvo mostra (para retomar a certa depois de um /resume).
    if let (Some(sid), Ok(polvo)) = (
        parsed.get("session_id").and_then(Value::as_str),
        std::env::var(POLVO_SESSION_ENV),
    ) {
        let file = active_conversation_file(&polvo);
        if active_conversation(&polvo).as_deref() != Some(sid) {
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let body = json!({ "sessionId": sid, "observedAt": paths::now_ms() });
            if let Ok(bytes) = serde_json::to_vec(&body) {
                let _ = paths::write_atomic(&file, &bytes);
            }
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

/// Percentual da janela de contexto em uso. Usa `used_percentage` quando o
/// Claude Code informa; senão calcula pelos tokens da última requisição.
fn context_percent(v: &Value) -> Option<f64> {
    let cw = v.get("context_window")?;
    if let Some(p) = cw.get("used_percentage").and_then(Value::as_f64) {
        return Some(p);
    }
    let size = cw.get("context_window_size").and_then(Value::as_f64)?;
    let usage = cw.get("current_usage")?;
    let tokens: f64 = [
        "input_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
    ]
    .iter()
    .filter_map(|k| usage.get(*k).and_then(Value::as_f64))
    .sum();
    (size > 0.0).then(|| (tokens / size * 100.0).min(100.0))
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
