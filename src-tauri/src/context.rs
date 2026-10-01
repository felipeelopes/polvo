//! Quanto da janela de contexto cada sessão já usou.
//!
//! - Claude Code: gravado por sessão pela ponte de statusline (`bridge.rs`).
//! - Codex CLI: último evento `token_count` do arquivo de sessão, com a mesma
//!   conta do Codex (desconta ~12 mil tokens fixos do prompt de sistema).
//! - Outros CLIs: o frontend tenta ler o percentual na própria tela.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use parking_lot::Mutex;
use serde_json::Value;
use tauri::State;

use crate::discovery;
use crate::paths;
use crate::registry::Registry;
use crate::tools::ToolKind;

/// Tokens que o Codex considera fixos ao calcular o "% context left".
const CODEX_BASELINE: f64 = 12_000.0;

/// Percentual usado por id de sessão do Polvo.
#[tauri::command]
pub async fn context_get(
    reg: State<'_, Registry>,
) -> crate::error::AppResult<HashMap<String, f64>> {
    let refs = reg.session_refs();
    Ok(tauri::async_runtime::spawn_blocking(move || {
        refs.into_iter()
            .filter_map(|(id, tool, sid)| {
                let sid = sid?;
                let pct = match tool {
                    ToolKind::Claude => claude(&sid),
                    ToolKind::Codex => codex(&sid),
                    _ => None,
                }?;
                Some((id, (pct * 10.0).round() / 10.0))
            })
            .collect()
    })
    .await
    .unwrap_or_default())
}

/// Prefere o percentual informado pela statusline; senão calcula pelos tokens
/// da última resposta gravada na conversa (`~/.claude/projects/*/<id>.jsonl`).
fn claude(session_id: &str) -> Option<f64> {
    let bridge: Option<Value> = fs::read(
        paths::usage_dir()
            .join("sessions")
            .join(format!("{session_id}.json")),
    )
    .ok()
    .and_then(|b| serde_json::from_slice(&b).ok());
    if let Some(p) = bridge
        .as_ref()
        .and_then(|v| v.get("contextPercent"))
        .and_then(Value::as_f64)
    {
        return Some(p);
    }
    let transcript = discovery::claude_transcript(session_id)?;
    let usage = last_line_value(&transcript, "\"usage\"", |v| {
        (v.get("type")?.as_str()? == "assistant")
            .then(|| v.pointer("/message/usage").cloned())
            .flatten()
    })?;
    let tokens: f64 = [
        "input_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
    ]
    .iter()
    .filter_map(|k| usage.get(*k).and_then(Value::as_f64))
    .sum();
    let model = bridge
        .as_ref()
        .and_then(|v| v.get("modelId"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    let window = if model.contains("[1m]") || tokens > 200_000.0 {
        1_000_000.0
    } else {
        200_000.0
    };
    Some((tokens / window * 100.0).min(100.0))
}

fn codex(session_id: &str) -> Option<f64> {
    let file = codex_rollout(session_id)?;
    let info = last_token_info(&file)?;
    let window = info.get("model_context_window")?.as_f64()?;
    let used = info.pointer("/last_token_usage/total_tokens")?.as_f64()?;
    if window <= CODEX_BASELINE {
        return None;
    }
    let pct = (used - CODEX_BASELINE).max(0.0) / (window - CODEX_BASELINE) * 100.0;
    Some(pct.clamp(0.0, 100.0))
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
    last_line_value(path, "\"token_count\"", |v| {
        v.pointer("/payload/info")
            .filter(|i| i.is_object())
            .cloned()
    })
}

/// Lê o final de um JSONL e devolve o primeiro valor (de trás para frente)
/// numa linha que contém `needle` e para o qual `pick` retorna algo.
fn last_line_value(
    path: &Path,
    needle: &str,
    pick: impl Fn(&Value) -> Option<Value>,
) -> Option<Value> {
    let mut f = fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(512 * 1024)))
        .ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    String::from_utf8_lossy(&buf)
        .lines()
        .rev()
        .filter(|l| l.contains(needle))
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find_map(|v| pick(&v))
}
