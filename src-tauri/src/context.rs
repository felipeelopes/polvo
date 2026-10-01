//! Metadados de cada sessão lidos dos arquivos dos próprios CLIs:
//!
//! - Claude Code: a conversa (`~/.claude/projects/*/<id>.jsonl`) é lida de forma
//!   incremental. Dela saem o nome dado com `/rename` (`custom-title`), a cor de
//!   `/color` (`agent-color`), o título automático (`ai-title`) e o uso de
//!   contexto da última resposta. A ponte de statusline, quando informa um
//!   percentual maior que zero, tem prioridade para o contexto.
//! - Codex CLI: último evento `token_count` do arquivo de sessão, com a mesma
//!   conta do Codex (desconta ~12 mil tokens fixos do prompt de sistema).
//! - Outros CLIs: o frontend tenta ler o percentual na própria tela.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::discovery;
use crate::paths;
use crate::registry::Registry;
use crate::tools::ToolKind;

/// Tokens que o Codex considera fixos ao calcular o "% context left".
const CODEX_BASELINE: f64 = 12_000.0;

#[derive(Serialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    /// Percentual da janela de contexto em uso.
    pub context: Option<f64>,
    /// Conversa que o CLI mostra agora, quando difere da registrada.
    #[serde(skip)]
    pub conversation: Option<String>,
    /// Nome dado no CLI (`/rename`).
    pub custom_title: Option<String>,
    /// Título automático do CLI.
    pub ai_title: Option<String>,
    /// Cor escolhida no CLI (`/color`).
    pub color: Option<String>,
}

/// Lê os metadados de todas as sessões em execução e aplica nome e cor
/// definidos no CLI (`/rename`, `/color`) ao registro.
#[tauri::command]
pub async fn session_meta(
    app: AppHandle,
    reg: State<'_, Registry>,
) -> crate::error::AppResult<HashMap<String, SessionMeta>> {
    let refs = reg.session_refs();
    let metas: HashMap<String, SessionMeta> = tauri::async_runtime::spawn_blocking(move || {
        refs.into_iter()
            .filter_map(|(id, tool, sid)| {
                let sid = sid?;
                let meta = match tool {
                    ToolKind::Claude => match crate::bridge::active_conversation(&id) {
                        Some(now) if now != sid => SessionMeta {
                            conversation: Some(now.clone()),
                            ..claude(&now)
                        },
                        _ => claude(&sid),
                    },
                    ToolKind::Codex => SessionMeta {
                        context: codex(&sid),
                        ..Default::default()
                    },
                    _ => return None,
                };
                Some((id, meta))
            })
            .collect()
    })
    .await
    .unwrap_or_default();
    reg.apply_cli_meta(&app, &metas);
    Ok(metas)
}

// ---------------------------------------------------------------- Claude Code

/// Estado da leitura incremental de uma conversa.
#[derive(Default)]
struct Tracked {
    path: PathBuf,
    offset: u64,
    custom_title: Option<String>,
    ai_title: Option<String>,
    color: Option<String>,
    tokens: Option<f64>,
}

type Tracker = Mutex<HashMap<String, Tracked>>;

fn tracker() -> &'static Tracker {
    static T: OnceLock<Tracker> = OnceLock::new();
    T.get_or_init(Default::default)
}

fn claude(session_id: &str) -> SessionMeta {
    let bridge: Option<Value> = fs::read(
        paths::usage_dir()
            .join("sessions")
            .join(format!("{session_id}.json")),
    )
    .ok()
    .and_then(|b| serde_json::from_slice(&b).ok());
    let model = bridge
        .as_ref()
        .and_then(|v| v.get("modelId"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut meta = SessionMeta::default();
    if let Some(path) = discovery::claude_transcript(session_id) {
        let mut all = tracker().lock();
        let t = all.entry(session_id.to_string()).or_default();
        if t.path != path {
            *t = Tracked {
                path: path.clone(),
                ..Default::default()
            };
        }
        read_new_lines(t);
        meta.custom_title = t.custom_title.clone();
        meta.ai_title = t.ai_title.clone();
        meta.color = t.color.clone();
        meta.context = t.tokens.map(|tokens| {
            let window = if model.contains("[1m]") || tokens > 200_000.0 {
                1_000_000.0
            } else {
                200_000.0
            };
            (tokens / window * 100.0).min(100.0)
        });
    }
    // Logo após abrir ou retomar, a statusline informa 0 até a próxima resposta
    // do modelo; nesse caso vale o valor calculado pela conversa.
    if let Some(p) = bridge
        .as_ref()
        .and_then(|v| v.get("contextPercent"))
        .and_then(Value::as_f64)
        .filter(|p| *p > 0.0)
    {
        meta.context = Some(p);
    }
    meta.context = meta.context.map(|p| (p * 10.0).round() / 10.0);
    meta
}

/// Processa só as linhas completas acrescentadas desde a última leitura.
fn read_new_lines(t: &mut Tracked) {
    let Ok(mut f) = fs::File::open(&t.path) else {
        return;
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len < t.offset {
        // Arquivo reescrito: recomeça.
        *t = Tracked {
            path: t.path.clone(),
            ..Default::default()
        };
    }
    if len == t.offset || f.seek(SeekFrom::Start(t.offset)).is_err() {
        return;
    }
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_err() {
        return;
    }
    let Some(end) = buf.iter().rposition(|b| *b == b'\n') else {
        return;
    };
    let text = String::from_utf8_lossy(&buf[..end]);
    for line in text.lines() {
        apply_line(t, line);
    }
    t.offset += end as u64 + 1;
}

fn apply_line(t: &mut Tracked, line: &str) {
    let interesting = line.contains("\"custom-title\"")
        || line.contains("\"agent-color\"")
        || line.contains("\"ai-title\"")
        || (line.contains("\"usage\"") && line.contains("\"assistant\""));
    if !interesting {
        return;
    }
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    match v.get("type").and_then(Value::as_str) {
        Some("custom-title") => t.custom_title = text("customTitle"),
        Some("agent-color") => t.color = text("agentColor"),
        Some("ai-title") => t.ai_title = text("aiTitle"),
        Some("assistant") => {
            if let Some(usage) = v.pointer("/message/usage") {
                let tokens: f64 = [
                    "input_tokens",
                    "cache_creation_input_tokens",
                    "cache_read_input_tokens",
                ]
                .iter()
                .filter_map(|k| usage.get(*k).and_then(Value::as_f64))
                .sum();
                if tokens > 0.0 {
                    t.tokens = Some(tokens);
                }
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------- Codex CLI

fn codex(session_id: &str) -> Option<f64> {
    let file = codex_rollout(session_id)?;
    let info = last_token_info(&file)?;
    let window = info.get("model_context_window")?.as_f64()?;
    let used = info.pointer("/last_token_usage/total_tokens")?.as_f64()?;
    if window <= CODEX_BASELINE {
        return None;
    }
    let pct = (used - CODEX_BASELINE).max(0.0) / (window - CODEX_BASELINE) * 100.0;
    Some((pct.clamp(0.0, 100.0) * 10.0).round() / 10.0)
}

/// Acha (e guarda) o arquivo de sessão do Codex pelo id no nome do arquivo.
fn codex_rollout(session_id: &str) -> Option<PathBuf> {
    static CACHE: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(p) = cache.lock().get(session_id).filter(|p| p.is_file()) {
        return Some(p.clone());
    }
    let suffix = format!("{session_id}.jsonl");
    let found = discovery::codex_rollouts(60).into_iter().find(|p| {
        p.file_name()
            .is_some_and(|n| n.to_string_lossy().ends_with(&suffix))
    })?;
    cache.lock().insert(session_id.to_string(), found.clone());
    Some(found)
}

fn last_token_info(path: &Path) -> Option<Value> {
    let mut f = fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(512 * 1024)))
        .ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    String::from_utf8_lossy(&buf)
        .lines()
        .rev()
        .filter(|l| l.contains("\"token_count\""))
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find_map(|v| {
            v.pointer("/payload/info")
                .filter(|i| i.is_object())
                .cloned()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_rename_color_and_usage() {
        let mut t = Tracked::default();
        apply_line(
            &mut t,
            r#"{"type":"custom-title","customTitle":"Zoom com teclado","sessionId":"x"}"#,
        );
        apply_line(
            &mut t,
            r#"{"type":"agent-color","agentColor":"green","sessionId":"x"}"#,
        );
        apply_line(
            &mut t,
            r#"{"type":"ai-title","aiTitle":"Tela de plano","sessionId":"x"}"#,
        );
        apply_line(
            &mut t,
            r#"{"type":"assistant","message":{"usage":{"input_tokens":2,"cache_creation_input_tokens":8,"cache_read_input_tokens":90}}}"#,
        );
        assert_eq!(t.custom_title.as_deref(), Some("Zoom com teclado"));
        assert_eq!(t.color.as_deref(), Some("green"));
        assert_eq!(t.ai_title.as_deref(), Some("Tela de plano"));
        assert_eq!(t.tokens, Some(100.0));
    }
}
