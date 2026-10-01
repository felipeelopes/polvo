//! Pseudo-terminais (ConPTY) que executam os CLIs.
//!
//! Cada sessão guarda um histórico recente da saída. Assim uma janela pode se
//! conectar (ou reconectar, ao mover a sessão para outro monitor) e reconstruir
//! a tela antes de receber os dados ao vivo.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult, Context};
use crate::tools::LaunchPlan;

/// Variáveis de sessão de agentes que não devem passar para os processos filhos.
const INHERITED_AGENT_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
];

/// Quanto da saída recente é guardado para reconectar uma janela.
const SCROLLBACK_BYTES: usize = 768 * 1024;

#[derive(Default)]
struct Output {
    history: Vec<u8>,
    trimmed: bool,
    subscriber: Option<Channel<InvokeResponseBody>>,
}

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    output: Arc<Mutex<Output>>,
}

#[derive(Default)]
pub struct PtyManager {
    ptys: Mutex<HashMap<String, Pty>>,
    generation: AtomicU64,
}

impl PtyManager {
    /// Inicia o processo e devolve a "geração", usada para ignorar eventos de
    /// saída de um processo antigo depois de um reinício.
    pub fn spawn(
        &self,
        app: &AppHandle,
        id: &str,
        plan: &LaunchPlan,
        cwd: &Path,
    ) -> AppResult<u64> {
        self.kill(id);

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 32,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .ctx("Falha ao abrir o pseudo-terminal")?;

        let mut cmd = CommandBuilder::new(&plan.program);
        cmd.args(&plan.args);
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env(crate::bridge::POLVO_SESSION_ENV, id);
        // Se o Polvo foi aberto de dentro de outro agente, não deixa os
        // marcadores dele vazarem: o Claude Code, por exemplo, desliga a
        // gravação da conversa (e o resume) quando se vê como "sessão filha".
        for (key, _) in std::env::vars_os() {
            let k = key.to_string_lossy();
            if INHERITED_AGENT_VARS.contains(&k.as_ref()) {
                cmd.env_remove(&key);
            }
        }
        for (k, v) in &plan.env {
            cmd.env(k, v);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .ctx("Falha ao iniciar o processo")?;
        drop(pair.slave);

        let killer = child.clone_killer();
        let mut reader = pair
            .master
            .try_clone_reader()
            .ctx("Falha ao ler o terminal")?;
        let writer = pair
            .master
            .take_writer()
            .ctx("Falha ao escrever no terminal")?;
        let output = Arc::new(Mutex::new(Output::default()));
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;

        let out = output.clone();
        thread::Builder::new()
            .name(format!("pty-read-{id}"))
            .spawn(move || {
                let mut buf = vec![0u8; 32 * 1024];
                loop {
                    let n = match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => n,
                    };
                    let chunk = &buf[..n];
                    let mut o = out.lock();
                    o.history.extend_from_slice(chunk);
                    if o.history.len() > SCROLLBACK_BYTES {
                        let cut = o.history.len() - SCROLLBACK_BYTES;
                        o.history.drain(..cut);
                        o.trimmed = true;
                    }
                    if let Some(ch) = &o.subscriber {
                        if ch.send(InvokeResponseBody::Raw(chunk.to_vec())).is_err() {
                            o.subscriber = None;
                        }
                    }
                }
            })?;

        let app2 = app.clone();
        let id2 = id.to_string();
        thread::Builder::new()
            .name(format!("pty-wait-{id}"))
            .spawn(move || {
                let code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
                app2.state::<crate::registry::Registry>()
                    .on_exit(&app2, &id2, generation, code);
            })?;

        self.ptys.lock().insert(
            id.to_string(),
            Pty {
                master: pair.master,
                writer,
                killer,
                output,
            },
        );
        Ok(generation)
    }

    pub fn attach(&self, id: &str, channel: Channel<InvokeResponseBody>) -> AppResult<Vec<u8>> {
        let ptys = self.ptys.lock();
        let pty = ptys
            .get(id)
            .ok_or_else(|| AppError::msg("Sessão não está em execução"))?;
        let mut o = pty.output.lock();
        o.subscriber = Some(channel);
        let mut history = o.history.clone();
        if o.trimmed {
            // Começa numa quebra de linha para não reproduzir uma sequência cortada.
            if let Some(nl) = history.iter().position(|b| *b == b'\n') {
                history.drain(..=nl);
            }
            history.splice(0..0, b"\x1b[0m".iter().copied());
        }
        Ok(history)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> AppResult<()> {
        let mut ptys = self.ptys.lock();
        let pty = ptys
            .get_mut(id)
            .ok_or_else(|| AppError::msg("Sessão não está em execução"))?;
        pty.writer.write_all(data)?;
        pty.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
        if cols < 2 || rows < 2 {
            return Ok(());
        }
        let ptys = self.ptys.lock();
        if let Some(p) = ptys.get(id) {
            p.master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .ctx("Falha ao redimensionar")?;
        }
        Ok(())
    }

    pub fn kill(&self, id: &str) {
        if let Some(mut p) = self.ptys.lock().remove(id) {
            let _ = p.killer.kill();
        }
    }

    /// Remove o registro de um processo que já terminou sozinho.
    pub fn forget(&self, id: &str) {
        self.ptys.lock().remove(id);
    }

    pub fn kill_all(&self) {
        for (_, mut p) in self.ptys.lock().drain() {
            let _ = p.killer.kill();
        }
    }
}

// ---------------------------------------------------------------- comandos

#[tauri::command]
pub fn pty_attach(
    pty: State<PtyManager>,
    id: String,
    channel: Channel<InvokeResponseBody>,
) -> AppResult<tauri::ipc::Response> {
    Ok(tauri::ipc::Response::new(pty.attach(&id, channel)?))
}

#[tauri::command]
pub fn pty_write(pty: State<PtyManager>, id: String, data: String) -> AppResult<()> {
    pty.write(&id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(pty: State<PtyManager>, id: String, cols: u16, rows: u16) -> AppResult<()> {
    pty.resize(&id, cols, rows)
}
