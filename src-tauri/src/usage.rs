//! Limites de uso de cada provedor, lidos de fontes locais:
//!
//! - Claude Code: arquivo gravado pela ponte de statusline (`bridge.rs`).
//! - Codex CLI: eventos `token_count` com `rate_limits` nos arquivos de sessão.
//! - OpenCode: custo de hoje e do mês via `opencode stats` (usa chaves de API,
//!   então não há limite de plano).

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::process::Command;

use serde::Serialize;
use serde_json::Value;

use crate::discovery;
use crate::paths;
use crate::settings::SettingsState;
use crate::tools::ToolKind;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub label: String,
    pub short: String,
    /// Percentual usado (0–100). `None` quando só há um valor (ex.: custo).
    pub used_percent: Option<f64>,
    /// Momento em que a janela reinicia (ms desde a época Unix).
    pub resets_at: Option<i64>,
    pub value: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub provider: ToolKind,
    pub plan: Option<String>,
    pub windows: Vec<UsageWindow>,
    pub observed_at: i64,
}

#[tauri::command]
pub async fn usage_get(
    settings: tauri::State<'_, SettingsState>,
) -> crate::error::AppResult<Vec<UsageSnapshot>> {
    let disabled = settings.get().disabled_tools;
    Ok(tauri::async_runtime::spawn_blocking(move || {
        let on = |t: ToolKind| !disabled.contains(&t);
        [
            on(ToolKind::Claude).then(claude).flatten(),
            on(ToolKind::Codex).then(codex).flatten(),
            on(ToolKind::Opencode).then(opencode).flatten(),
        ]
        .into_iter()
        .flatten()
        .collect()
    })
    .await
    .unwrap_or_default())
}

fn secs_to_ms(v: Option<&Value>) -> Option<i64> {
    v.and_then(Value::as_f64).map(|s| (s * 1000.0) as i64)
}

fn claude() -> Option<UsageSnapshot> {
    let v: Value =
        serde_json::from_slice(&fs::read(paths::usage_dir().join("claude.json")).ok()?).ok()?;
    let win = |key: &str, label: &str, short: &str| {
        let w = v.get(key)?;
        Some(UsageWindow {
            label: label.into(),
            short: short.into(),
            used_percent: w.get("used_percentage").and_then(Value::as_f64),
            resets_at: secs_to_ms(w.get("resets_at")),
            value: None,
        })
    };
    let windows: Vec<_> = [
        win("fiveHour", "Sessão (janela de 5h)", "5h"),
        win("sevenDay", "Semanal", "sem"),
    ]
    .into_iter()
    .flatten()
    .collect();
    (!windows.is_empty()).then(|| UsageSnapshot {
        provider: ToolKind::Claude,
        plan: None,
        windows,
        observed_at: v.get("observedAt").and_then(Value::as_i64).unwrap_or(0),
    })
}

fn codex() -> Option<UsageSnapshot> {
    for file in discovery::codex_rollouts(14).iter().take(12) {
        if let Some(limits) = last_rate_limits(file) {
            let window = |w: &Value| {
                let minutes = w.get("window_minutes").and_then(Value::as_i64).unwrap_or(0);
                let (label, short) = match minutes {
                    300 => ("Janela de 5h".to_string(), "5h".to_string()),
                    10080 => ("Semanal".to_string(), "sem".to_string()),
                    m if m % 1440 == 0 && m > 0 => (
                        format!("Janela de {} dias", m / 1440),
                        format!("{}d", m / 1440),
                    ),
                    m => (format!("Janela de {}h", m / 60), format!("{}h", m / 60)),
                };
                UsageWindow {
                    label,
                    short,
                    used_percent: w.get("used_percent").and_then(Value::as_f64),
                    resets_at: secs_to_ms(w.get("resets_at")),
                    value: None,
                }
            };
            let windows: Vec<_> = ["primary", "secondary"]
                .iter()
                .filter_map(|k| limits.get(*k).filter(|v| v.is_object()).map(window))
                .collect();
            if windows.is_empty() {
                continue;
            }
            return Some(UsageSnapshot {
                provider: ToolKind::Codex,
                plan: limits
                    .get("plan_type")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                windows,
                observed_at: paths::to_ms(discovery::modified(file)),
            });
        }
    }
    None
}

/// Lê só o final do arquivo, onde estão os eventos mais recentes.
fn last_rate_limits(path: &Path) -> Option<Value> {
    let mut f = fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(512 * 1024);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    text.lines()
        .rev()
        .filter(|l| l.contains("\"rate_limits\""))
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find_map(|v| {
            v.pointer("/payload/rate_limits")
                .filter(|r| r.is_object())
                .cloned()
        })
}

fn opencode() -> Option<UsageSnapshot> {
    let today = opencode_cost(1)?;
    let month = opencode_cost(30);
    let mut windows = vec![UsageWindow {
        label: "Gasto hoje".into(),
        short: "hoje".into(),
        used_percent: None,
        resets_at: None,
        value: Some(today),
    }];
    if let Some(m) = month {
        windows.push(UsageWindow {
            label: "Gasto em 30 dias".into(),
            short: "30d".into(),
            used_percent: None,
            resets_at: None,
            value: Some(m),
        });
    }
    Some(UsageSnapshot {
        provider: ToolKind::Opencode,
        plan: Some("Chaves de API próprias".into()),
        windows,
        observed_at: paths::now_ms(),
    })
}

fn opencode_cost(days: u32) -> Option<String> {
    let program = crate::tools::resolve("opencode")?;
    let mut cmd = Command::new(&program.path);
    cmd.args(&program.prefix)
        .args(["stats", "--days", &days.to_string()]);
    discovery::hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    parse_total_cost(&String::from_utf8_lossy(&out.stdout))
}

fn parse_total_cost(text: &str) -> Option<String> {
    text.lines()
        .find(|l| l.contains("Total Cost"))?
        .split_whitespace()
        .find(|t| t.starts_with('$'))
        .map(|t| t.trim_end_matches(['│', '|']).to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_opencode_total_cost() {
        let text = "│Total Cost                                        $1.25 │\n";
        assert_eq!(super::parse_total_cost(text).as_deref(), Some("$1.25"));
    }
}
