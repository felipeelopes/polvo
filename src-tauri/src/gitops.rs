//! Gerenciador de git do Polvo: status, diff, commit, branches, histórico,
//! stash, sincronização e GitHub. Tudo pelo git da linha de comando, para
//! respeitar a configuração, os hooks e as credenciais do usuário.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::discovery::hide_console;
use crate::error::{AppError, AppResult};
use crate::i18n::tr;

/// Diffs maiores que isso são cortados (o painel avisa).
const MAX_DIFF: usize = 6 * 1024 * 1024;

/// Uma escrita por repositório de cada vez (dois cliques rápidos não brigam pelo índice).
fn repo_lock(repo: &str) -> std::sync::Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, std::sync::Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS
        .get_or_init(Default::default)
        .lock()
        .entry(repo.to_lowercase())
        .or_default()
        .clone()
}

fn command(repo: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(["-c", "core.quotepath=false", "-c", "color.ui=never"])
        .args(args)
        // Nunca travar esperando um editor ou uma senha no terminal.
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_MERGE_AUTOEDIT", "no");
    hide_console(&mut cmd);
    cmd
}

/// Mensagem de erro do git, sem as linhas de dica.
fn git_error(stderr: &[u8], stdout: &[u8]) -> AppError {
    let text = String::from_utf8_lossy(stderr);
    let msg: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("hint:"))
        .collect();
    let msg = if msg.is_empty() {
        String::from_utf8_lossy(stdout).trim().to_string()
    } else {
        msg.join("\n")
    };
    AppError::msg(
        msg.trim_start_matches("fatal: ")
            .trim_start_matches("error: ")
            .to_string(),
    )
}

fn run_with(
    repo: &str,
    args: &[&str],
    stdin: Option<&[u8]>,
    ok_codes: &[i32],
) -> AppResult<String> {
    run_cmd(repo, args, stdin, ok_codes, &[])
}

fn run_cmd(
    repo: &str,
    args: &[&str],
    stdin: Option<&[u8]>,
    ok_codes: &[i32],
    env: &[(&str, &str)],
) -> AppResult<String> {
    let mut cmd = command(repo, args);
    cmd.envs(env.iter().copied());
    cmd.stdin(if stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|_| AppError::msg(tr("projects.gitNotFound", &[])))?;
    if let (Some(data), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(data)?;
    }
    let out = child.wait_with_output()?;
    let code = out.status.code().unwrap_or(-1);
    if out.status.success() || ok_codes.contains(&code) {
        let mut s = out.stdout;
        s.truncate(MAX_DIFF);
        Ok(String::from_utf8_lossy(&s).into_owned())
    } else {
        Err(git_error(&out.stderr, &out.stdout))
    }
}

/// Como `run_with`, com variáveis de ambiente a mais (ex.: outro índice).
fn run_env(
    repo: &str,
    args: &[&str],
    stdin: Option<&[u8]>,
    env: &[(&str, &str)],
) -> AppResult<String> {
    run_cmd(repo, args, stdin, &[], env)
}

fn run(repo: &str, args: &[&str]) -> AppResult<String> {
    run_with(repo, args, None, &[])
}

/// Leitura que não pega o lock do índice (os agentes podem estar usando o git).
fn read(repo: &str, args: &[&str]) -> AppResult<String> {
    let mut full = vec!["--no-optional-locks"];
    full.extend_from_slice(args);
    run(repo, &full)
}

/// Escrita com o lock do repositório.
fn write(repo: &str, args: &[&str]) -> AppResult<String> {
    let lock = repo_lock(repo);
    let _g = lock.lock();
    run(repo, args)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

// ------------------------------------------------------------------ status

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub orig: Option<String>,
    /// Estado no índice (`.` = sem mudança).
    pub x: String,
    /// Estado na pasta de trabalho.
    pub y: String,
    pub untracked: bool,
    pub conflict: bool,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub root: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<FileChange>,
    /// merge, rebase, cherry-pick ou revert em andamento.
    pub operation: Option<String>,
    pub stashes: u32,
    /// Branch sem nenhum commit ainda.
    pub unborn: bool,
}

fn parse_status(out: &str) -> Status {
    let mut st = Status::default();
    let mut tokens = out.split('\0').filter(|t| !t.is_empty());
    while let Some(tok) = tokens.next() {
        if let Some(h) = tok.strip_prefix("# ") {
            if let Some(v) = h.strip_prefix("branch.oid ") {
                st.unborn = v == "(initial)";
                st.head = (!st.unborn).then(|| v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.head ") {
                st.branch = (v != "(detached)").then(|| v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.upstream ") {
                st.upstream = Some(v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.ab ") {
                for part in v.split_whitespace() {
                    if let Some(n) = part.strip_prefix('+') {
                        st.ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix('-') {
                        st.behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        let kind = tok.chars().next().unwrap_or(' ');
        let xy = tok.get(2..4).unwrap_or("..");
        let (x, y) = (xy[..1].to_string(), xy[1..].to_string());
        match kind {
            '1' => {
                if let Some(path) = tok.splitn(9, ' ').nth(8) {
                    st.files.push(FileChange {
                        path: path.into(),
                        orig: None,
                        x,
                        y,
                        untracked: false,
                        conflict: false,
                    });
                }
            }
            '2' => {
                if let Some(path) = tok.splitn(10, ' ').nth(9) {
                    let orig = tokens.next().map(String::from);
                    st.files.push(FileChange {
                        path: path.into(),
                        orig,
                        x,
                        y,
                        untracked: false,
                        conflict: false,
                    });
                }
            }
            'u' => {
                if let Some(path) = tok.splitn(11, ' ').nth(10) {
                    st.files.push(FileChange {
                        path: path.into(),
                        orig: None,
                        x,
                        y,
                        untracked: false,
                        conflict: true,
                    });
                }
            }
            '?' => st.files.push(FileChange {
                path: tok[2..].into(),
                orig: None,
                x: ".".into(),
                y: "?".into(),
                untracked: true,
                conflict: false,
            }),
            _ => {}
        }
    }
    st
}

fn operation(repo: &str) -> Option<String> {
    let dir = read(repo, &["rev-parse", "--git-dir"]).ok()?;
    let dir = Path::new(repo).join(dir.trim());
    [
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
    ]
    .iter()
    .find(|(f, _)| dir.join(f).exists())
    .map(|(_, op)| op.to_string())
}

fn status_of(repo: &str) -> AppResult<Status> {
    let root = read(repo, &["rev-parse", "--show-toplevel"])
        .map_err(|_| AppError::msg(tr("git.notRepo", &[])))?;
    let out = read(
        repo,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--untracked-files=all",
        ],
    )?;
    let mut st = parse_status(&out);
    st.root = root.trim().replace('/', "\\");
    st.operation = operation(repo);
    st.stashes = read(repo, &["stash", "list"])
        .map(|s| s.lines().count() as u32)
        .unwrap_or(0);
    Ok(st)
}

#[tauri::command]
pub async fn git_status(repo: String) -> AppResult<Status> {
    blocking(move || status_of(&repo)).await
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub branch: Option<String>,
    pub changed: u32,
    pub conflicts: u32,
    pub ahead: u32,
    pub behind: u32,
}

/// Resumo leve (selos da barra lateral) de várias pastas.
#[tauri::command]
pub async fn git_summaries(paths: Vec<String>) -> HashMap<String, Summary> {
    blocking(move || {
        Ok(paths
            .into_iter()
            .filter_map(|p| {
                let out = read(
                    &p,
                    &[
                        "status",
                        "--porcelain=v2",
                        "-z",
                        "--branch",
                        "--untracked-files=normal",
                    ],
                )
                .ok()?;
                let st = parse_status(&out);
                let conflicts = st.files.iter().filter(|f| f.conflict).count() as u32;
                Some((
                    p,
                    Summary {
                        branch: st.branch,
                        changed: st.files.len() as u32,
                        conflicts,
                        ahead: st.ahead,
                        behind: st.behind,
                    },
                ))
            })
            .collect())
    })
    .await
    .unwrap_or_default()
}

// ------------------------------------------------------------------ diff

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffReq {
    repo: String,
    path: String,
    orig: Option<String>,
    /// worktree | staged | untracked | commit
    kind: String,
    sha: Option<String>,
    context: Option<u32>,
    ignore_ws: Option<bool>,
}

#[tauri::command]
pub async fn git_diff(req: DiffReq) -> AppResult<String> {
    blocking(move || {
        let ctx = format!("-U{}", req.context.unwrap_or(3));
        let mut args: Vec<String> = vec!["--no-optional-locks".into()];
        match req.kind.as_str() {
            "untracked" => {
                args.extend(
                    [
                        "diff",
                        "--no-index",
                        "--no-color",
                        &ctx,
                        "--",
                        "/dev/null",
                        &req.path,
                    ]
                    .map(String::from),
                );
                return run_with(
                    &req.repo,
                    &args.iter().map(String::as_str).collect::<Vec<_>>(),
                    None,
                    &[1],
                );
            }
            "commit" => {
                let sha = req.sha.clone().unwrap_or_default();
                args.extend(
                    [
                        "show",
                        "--format=",
                        "--no-color",
                        "-M",
                        "--diff-merges=first-parent",
                        &ctx,
                        &sha,
                    ]
                    .map(String::from),
                );
            }
            "staged" => {
                args.extend(["diff", "--cached", "--no-color", "-M", &ctx].map(String::from))
            }
            _ => args.extend(["diff", "--no-color", &ctx].map(String::from)),
        }
        if req.ignore_ws.unwrap_or(false) {
            args.push("-w".into());
        }
        args.push("--".into());
        if let Some(o) = req.orig.filter(|o| o != &req.path) {
            args.push(o);
        }
        args.push(req.path);
        run(
            &req.repo,
            &args.iter().map(String::as_str).collect::<Vec<_>>(),
        )
    })
    .await
}

/// Conteúdo de um arquivo numa revisão (`HEAD`, `:0` = índice, sha…), em base64-free bytes.
#[tauri::command]
pub async fn git_file_at(
    repo: String,
    rev: String,
    path: String,
) -> AppResult<tauri::ipc::Response> {
    blocking(move || {
        let spec = format!("{rev}:{}", path.replace('\\', "/"));
        let out = command(&repo, &["show", &spec]).output()?;
        if !out.status.success() {
            return Err(git_error(&out.stderr, &out.stdout));
        }
        Ok(tauri::ipc::Response::new(out.stdout))
    })
    .await
}

// ------------------------------------------------------------------ índice e commit

#[tauri::command]
pub async fn git_stage(repo: String, paths: Vec<String>) -> AppResult<()> {
    blocking(move || {
        let mut args = vec!["add", "-A", "--"];
        args.extend(paths.iter().map(String::as_str));
        write(&repo, &args).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn git_unstage(repo: String, paths: Vec<String>) -> AppResult<()> {
    blocking(move || {
        let unborn = read(&repo, &["rev-parse", "--verify", "-q", "HEAD"]).is_err();
        let mut args = if unborn {
            vec!["rm", "--cached", "-r", "-q", "--"]
        } else {
            vec!["restore", "--staged", "--"]
        };
        args.extend(paths.iter().map(String::as_str));
        write(&repo, &args).map(|_| ())
    })
    .await
}

/// Aplica um patch parcial (linhas/trechos): no índice (`cached`) ou na pasta, normal ou ao contrário.
#[tauri::command]
pub async fn git_apply(repo: String, patch: String, cached: bool, reverse: bool) -> AppResult<()> {
    blocking(move || {
        let mut args = vec!["apply", "--whitespace=nowarn"];
        if cached {
            args.push("--cached");
        }
        if reverse {
            args.push("--reverse");
        }
        args.push("-");
        let lock = repo_lock(&repo);
        let _g = lock.lock();
        run_with(&repo, &args, Some(patch.as_bytes()), &[]).map(|_| ())
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardItem {
    path: String,
    orig: Option<String>,
    x: String,
    untracked: bool,
}

/// Descarta alterações. O arquivo atual vai para a Lixeira antes (dá para recuperar).
#[tauri::command]
pub async fn git_discard(repo: String, files: Vec<DiscardItem>) -> AppResult<()> {
    blocking(move || {
        let root = PathBuf::from(read(&repo, &["rev-parse", "--show-toplevel"])?.trim());
        let lock = repo_lock(&repo);
        let _g = lock.lock();
        for f in files {
            let abs = root.join(&f.path);
            if abs.exists() {
                trash::delete(&abs).map_err(|e| AppError::msg(e.to_string()))?;
            }
            if f.untracked {
                continue;
            }
            if f.x == "A" {
                let _ = run(&repo, &["rm", "--cached", "-q", "--", &f.path]);
                continue;
            }
            let mut args = vec![
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                f.path.as_str(),
            ];
            if let Some(o) = f.orig.as_deref() {
                args.push(o);
            }
            run(&repo, &args)?;
        }
        Ok(())
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitReq {
    repo: String,
    message: String,
    amend: bool,
    no_verify: bool,
    /// Sem nada no índice: inclui todas as alterações.
    all: bool,
    sign_off: bool,
    /// Arquivos marcados na lista: o commit leva só eles (vazio = o índice inteiro).
    #[serde(default)]
    paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDone {
    sha: String,
    subject: String,
}

#[tauri::command]
pub async fn git_commit(req: CommitReq) -> AppResult<CommitDone> {
    blocking(move || {
        let lock = repo_lock(&req.repo);
        let _g = lock.lock();
        // Só os marcados: um índice temporário com o HEAD + esses arquivos,
        // sem mexer no que os outros têm no índice de verdade.
        let tmp = if req.paths.is_empty() {
            None
        } else {
            Some(selected_index(&req.repo, &req.paths)?)
        };
        let tmp_s = tmp.as_ref().map(|p| p.to_string_lossy().into_owned());
        let env: Vec<(&str, &str)> = tmp_s
            .as_deref()
            .map(|p| vec![("GIT_INDEX_FILE", p)])
            .unwrap_or_default();
        if req.all && tmp.is_none() {
            run(&req.repo, &["add", "-A"])?;
        }
        let mut args = vec!["commit", "--cleanup=strip"];
        if req.amend {
            args.push("--amend");
        }
        if req.no_verify {
            args.push("--no-verify");
        }
        if req.sign_off {
            args.push("--signoff");
        }
        let done = if req.amend && req.message.trim().is_empty() {
            args.push("--no-edit");
            run_env(&req.repo, &args, None, &env)
        } else {
            args.extend(["-F", "-"]);
            run_env(&req.repo, &args, Some(req.message.as_bytes()), &env)
        };
        if let Some(p) = &tmp {
            let _ = std::fs::remove_file(p);
        }
        done?;
        let out = run(&req.repo, &["log", "-1", "--format=%h%x1f%s"])?;
        let (sha, subject) = out.trim().split_once('\x1f').unwrap_or((out.trim(), ""));
        Ok(CommitDone {
            sha: sha.into(),
            subject: subject.into(),
        })
    })
    .await
}

/// Índice temporário para o commit dos arquivos marcados: parte do HEAD e
/// recebe a versão de cada arquivo no índice real. Quem estava todo fora do
/// índice entra inteiro antes; quem já tinha algo no índice (linhas escolhidas
/// no diff) vai do jeito que está. Chamar com o lock do repositório.
fn selected_index(repo: &str, paths: &[String]) -> AppResult<PathBuf> {
    let lit = [("GIT_LITERAL_PATHSPECS", "1")];
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    let unborn = read(repo, &["rev-parse", "--verify", "-q", "HEAD"]).is_err();

    // Marcados sem nada no índice (novos ou só na pasta) entram inteiros.
    let mut a = if unborn {
        vec!["ls-files", "-z", "--"]
    } else {
        vec![
            "diff",
            "--cached",
            "--no-renames",
            "--name-only",
            "-z",
            "--",
        ]
    };
    a.extend(&refs);
    let staged = run_env(repo, &a, None, &lit)?;
    let staged: Vec<&str> = staged.split('\0').filter(|p| !p.is_empty()).collect();
    let whole: Vec<&str> = refs
        .iter()
        .copied()
        .filter(|p| !staged.contains(p))
        .collect();
    if !whole.is_empty() {
        let mut a = vec!["add", "-A", "--"];
        a.extend(&whole);
        run_env(repo, &a, None, &lit)?;
    }

    let git_dir = read(repo, &["rev-parse", "--absolute-git-dir"])?;
    let tmp = PathBuf::from(git_dir.trim()).join("polvo-commit-index");
    let tmp_s = tmp.to_string_lossy().into_owned();
    let env = [("GIT_INDEX_FILE", tmp_s.as_str()), lit[0]];
    let fill = || -> AppResult<()> {
        let base = if unborn { "--empty" } else { "HEAD" };
        run_env(repo, &["read-tree", base], None, &env)?;
        let mut a = vec!["ls-files", "-s", "-z", "--"];
        a.extend(&refs);
        let entries = run_env(repo, &a, None, &lit)?;
        if !entries.is_empty() {
            run_env(
                repo,
                &["update-index", "-z", "--index-info"],
                Some(entries.as_bytes()),
                &env,
            )?;
        }
        let present: Vec<&str> = entries
            .split('\0')
            .filter_map(|e| e.split_once('\t').map(|(_, p)| p))
            .collect();
        let gone: Vec<&str> = refs
            .iter()
            .copied()
            .filter(|p| !present.contains(p))
            .collect();
        if !gone.is_empty() {
            let mut a = vec!["update-index", "--force-remove", "--"];
            a.extend(&gone);
            run_env(repo, &a, None, &env)?;
        }
        Ok(())
    };
    if let Err(e) = fill() {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(tmp)
}

/// Desfaz o último commit, mantendo as alterações no índice. Devolve a mensagem dele.
#[tauri::command]
pub async fn git_undo_commit(repo: String) -> AppResult<String> {
    blocking(move || {
        let msg = read(&repo, &["log", "-1", "--format=%B"])?;
        if read(&repo, &["rev-parse", "--verify", "-q", "HEAD~1"]).is_ok() {
            write(&repo, &["reset", "--soft", "HEAD~1"])?;
        } else {
            write(&repo, &["update-ref", "-d", "HEAD"])?;
        }
        Ok(msg.trim().to_string())
    })
    .await
}

/// Acrescenta um padrão ao `.gitignore` da raiz.
#[tauri::command]
pub async fn git_ignore(repo: String, pattern: String) -> AppResult<()> {
    blocking(move || {
        let root = PathBuf::from(read(&repo, &["rev-parse", "--show-toplevel"])?.trim());
        let file = root.join(".gitignore");
        let mut text = std::fs::read_to_string(&file).unwrap_or_default();
        if text.lines().any(|l| l.trim() == pattern) {
            return Ok(());
        }
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&pattern);
        text.push('\n');
        std::fs::write(file, text)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_init(path: String) -> AppResult<()> {
    blocking(move || run(&path, &["init"]).map(|_| ())).await
}

// ------------------------------------------------------------------ histórico

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    sha: String,
    short: String,
    parents: Vec<String>,
    author: String,
    email: String,
    date: i64,
    refs: Vec<String>,
    subject: String,
    body: String,
    unpushed: bool,
}

#[tauri::command]
pub async fn git_log(
    repo: String,
    skip: u32,
    limit: u32,
    search: Option<String>,
    rev: Option<String>,
    path: Option<String>,
) -> AppResult<Vec<Commit>> {
    blocking(move || {
        let skip = format!("--skip={skip}");
        let limit = format!("-n{limit}");
        let rev = rev.unwrap_or_else(|| "HEAD".into());
        let mut args = vec![
            "log",
            "-z",
            "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%b",
            &skip,
            &limit,
        ];
        let grep;
        if let Some(q) = search.as_deref().filter(|q| !q.trim().is_empty()) {
            grep = format!("--grep={}", q.trim());
            args.extend(["-i", "--fixed-strings", &grep]);
        }
        args.push(&rev);
        if let Some(p) = path.as_deref().filter(|p| !p.is_empty()) {
            args.extend(["--follow", "--", p]);
        }
        let out = match read(&repo, &args) {
            Ok(o) => o,
            // Branch sem commits.
            Err(_) if read(&repo, &["rev-parse", "--verify", "-q", "HEAD"]).is_err() => {
                return Ok(vec![])
            }
            Err(e) => return Err(e),
        };
        let unpushed: std::collections::HashSet<String> =
            read(&repo, &["rev-list", "-n500", "HEAD", "--not", "--remotes"])
                .unwrap_or_default()
                .lines()
                .map(String::from)
                .collect();
        Ok(out
            .split('\0')
            .filter(|r| !r.trim().is_empty())
            .filter_map(|r| {
                let f: Vec<&str> = r.trim_start_matches('\n').splitn(9, '\x1f').collect();
                (f.len() >= 8).then(|| Commit {
                    sha: f[0].into(),
                    short: f[1].into(),
                    parents: f[2].split_whitespace().map(String::from).collect(),
                    author: f[3].into(),
                    email: f[4].into(),
                    date: f[5].parse().unwrap_or(0),
                    refs: f[6]
                        .split(", ")
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .collect(),
                    subject: f[7].into(),
                    body: f.get(8).map(|b| b.trim().to_string()).unwrap_or_default(),
                    unpushed: unpushed.contains(f[0]),
                })
            })
            .collect())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    status: String,
    path: String,
    orig: Option<String>,
}

/// Arquivos alterados num commit.
#[tauri::command]
pub async fn git_commit_files(repo: String, sha: String) -> AppResult<Vec<CommitFile>> {
    blocking(move || {
        let out = read(
            &repo,
            &[
                "show",
                "--format=",
                "--name-status",
                "-z",
                "-M",
                "--diff-merges=first-parent",
                &sha,
            ],
        )?;
        let mut toks = out
            .split('\0')
            .map(|t| t.trim_start_matches('\n'))
            .filter(|t| !t.is_empty());
        let mut files = vec![];
        while let Some(st) = toks.next() {
            let letter = st.chars().next().unwrap_or('M');
            if letter == 'R' || letter == 'C' {
                let orig = toks.next().map(String::from);
                if let Some(p) = toks.next() {
                    files.push(CommitFile {
                        status: letter.into(),
                        path: p.into(),
                        orig,
                    });
                }
            } else if let Some(p) = toks.next() {
                files.push(CommitFile {
                    status: letter.into(),
                    path: p.into(),
                    orig: None,
                });
            }
        }
        Ok(files)
    })
    .await
}

// ------------------------------------------------------------------ branches

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    name: String,
    remote: bool,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    gone: bool,
    sha: String,
    date: i64,
    subject: String,
    current: bool,
    worktree: Option<String>,
}

#[tauri::command]
pub async fn git_branches(repo: String) -> AppResult<Vec<Branch>> {
    blocking(move || {
        let out = read(
            &repo,
            &[
                "for-each-ref",
                "--format=%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(objectname:short)%1f%(committerdate:unix)%1f%(subject)%1f%(HEAD)%1f%(worktreepath)",
                "refs/heads",
                "refs/remotes",
            ],
        )?;
        Ok(out
            .lines()
            .filter_map(|l| {
                let f: Vec<&str> = l.split('\x1f').collect();
                if f.len() < 9 || f[0].ends_with("/HEAD") {
                    return None;
                }
                let track = f[3];
                let num = |key: &str| {
                    track
                        .split(", ")
                        .find_map(|p| p.strip_prefix(key))
                        .and_then(|n| n.trim().parse().ok())
                        .unwrap_or(0)
                };
                Some(Branch {
                    name: f[1].into(),
                    remote: f[0].starts_with("refs/remotes/"),
                    upstream: (!f[2].is_empty()).then(|| f[2].into()),
                    ahead: num("ahead "),
                    behind: num("behind "),
                    gone: track == "gone",
                    sha: f[4].into(),
                    date: f[5].parse().unwrap_or(0),
                    subject: f[6].into(),
                    current: f[7] == "*",
                    worktree: (!f[8].is_empty()).then(|| f[8].replace('/', "\\")),
                })
            })
            .collect())
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAction {
    repo: String,
    /// checkout, create, rename, delete, merge, squash, rebase, cherry-pick,
    /// revert, reset, tag, continue, abort, skip, resolve, stash-push,
    /// stash-pop, stash-apply, stash-drop, worktree-add, worktree-remove,
    /// pr-checkout, delete-remote
    action: String,
    #[serde(default)]
    args: Vec<String>,
}

fn arg(a: &[String], i: usize) -> &str {
    a.get(i).map(String::as_str).unwrap_or("")
}

/// Ações que mudam o repositório. Devolve a saída do git (para avisos).
#[tauri::command]
pub async fn git_action(req: GitAction) -> AppResult<String> {
    blocking(move || {
        let r = req.repo.as_str();
        let a = &req.args;
        match req.action.as_str() {
            "checkout" => {
                let name = arg(a, 0);
                // Branch remota sem local: cria a local acompanhando a remota.
                if let Some((_, local)) = name.split_once('/').filter(|_| arg(a, 1) == "remote") {
                    if read(
                        r,
                        &[
                            "rev-parse",
                            "--verify",
                            "-q",
                            &format!("refs/heads/{local}"),
                        ],
                    )
                    .is_ok()
                    {
                        return write(r, &["switch", local]);
                    }
                    return write(r, &["switch", "--track", name]);
                }
                if arg(a, 1) == "detach" {
                    return write(r, &["switch", "--detach", name]);
                }
                write(r, &["switch", name])
            }
            "create" => {
                let mut args = vec!["switch", "-c", arg(a, 0)];
                if !arg(a, 1).is_empty() {
                    args.push(arg(a, 1));
                }
                write(r, &args)
            }
            "rename" => write(r, &["branch", "-m", arg(a, 0), arg(a, 1)]),
            "delete" => write(
                r,
                &[
                    "branch",
                    if arg(a, 1) == "force" { "-D" } else { "-d" },
                    arg(a, 0),
                ],
            ),
            "delete-remote" => {
                let (remote, name) = arg(a, 0).split_once('/').unwrap_or(("origin", arg(a, 0)));
                write(r, &["push", remote, "--delete", name])
            }
            "merge" => write(r, &["merge", "--no-edit", arg(a, 0)]),
            "squash" => write(r, &["merge", "--squash", arg(a, 0)]),
            "rebase" => write(r, &["rebase", arg(a, 0)]),
            "cherry-pick" => write(r, &["cherry-pick", arg(a, 0)]),
            "revert" => {
                let parents = read(r, &["rev-list", "--parents", "-n1", arg(a, 0)])?;
                if parents.split_whitespace().count() > 2 {
                    write(r, &["revert", "--no-edit", "-m", "1", arg(a, 0)])
                } else {
                    write(r, &["revert", "--no-edit", arg(a, 0)])
                }
            }
            "reset" => {
                let mode = match arg(a, 1) {
                    "hard" => "--hard",
                    "soft" => "--soft",
                    _ => "--mixed",
                };
                write(r, &["reset", mode, arg(a, 0)])
            }
            "tag" => {
                if arg(a, 2).is_empty() {
                    write(r, &["tag", arg(a, 0), arg(a, 1)])
                } else {
                    write(r, &["tag", "-a", arg(a, 0), "-m", arg(a, 2), arg(a, 1)])
                }
            }
            "continue" => match operation(r).as_deref() {
                Some("merge") => write(r, &["commit", "--no-edit"]),
                Some("rebase") => write(r, &["rebase", "--continue"]),
                Some("cherry-pick") => write(r, &["cherry-pick", "--continue"]),
                Some("revert") => write(r, &["revert", "--continue"]),
                _ => Ok(String::new()),
            },
            "abort" => match operation(r).as_deref() {
                Some(op) => write(r, &[op, "--abort"]),
                None => Ok(String::new()),
            },
            "skip" => match operation(r).as_deref() {
                Some(op @ ("rebase" | "cherry-pick" | "revert")) => write(r, &[op, "--skip"]),
                _ => Ok(String::new()),
            },
            "resolve" => {
                let path = arg(a, 0);
                match arg(a, 1) {
                    side @ ("ours" | "theirs") => {
                        let flag = format!("--{side}");
                        if write(r, &["checkout", &flag, "--", path]).is_err() {
                            // O lado escolhido apagou o arquivo.
                            return write(r, &["rm", "-q", "--", path]);
                        }
                        write(r, &["add", "--", path])
                    }
                    _ => write(r, &["add", "--", path]),
                }
            }
            "stash-push" => {
                // [mensagem, opções ("u" novos, "k" manter índice, "s" só o índice), caminhos…]
                let opts = if a.len() > 1 { arg(a, 1) } else { "u" };
                let mut args = vec!["stash", "push"];
                if opts.contains('s') {
                    args.push("--staged");
                } else if opts.contains('u') {
                    args.push("--include-untracked");
                }
                if opts.contains('k') && !opts.contains('s') {
                    args.push("--keep-index");
                }
                if !arg(a, 0).is_empty() {
                    args.extend(["-m", arg(a, 0)]);
                }
                if a.len() > 2 {
                    args.push("--");
                    args.extend(a[2..].iter().map(String::as_str));
                }
                write(r, &args)
            }
            "stash-branch" => {
                let spec = format!("stash@{{{}}}", arg(a, 1));
                write(r, &["stash", "branch", arg(a, 0), &spec])
            }
            "stash-pop" | "stash-apply" | "stash-drop" => {
                let verb = &req.action[6..];
                let spec = format!("stash@{{{}}}", arg(a, 0));
                write(r, &["stash", verb, &spec])
            }
            "worktree-add" => {
                // [caminho, branch, nova?, ponto de partida]
                if arg(a, 2) == "new" {
                    let mut args = vec!["worktree", "add", "-b", arg(a, 1), arg(a, 0)];
                    if !arg(a, 3).is_empty() {
                        args.push(arg(a, 3));
                    }
                    write(r, &args)
                } else {
                    write(r, &["worktree", "add", arg(a, 0), arg(a, 1)])
                }
            }
            "worktree-remove" => {
                if arg(a, 1) == "force" {
                    write(r, &["worktree", "remove", "--force", arg(a, 0)])
                } else {
                    write(r, &["worktree", "remove", arg(a, 0)])
                }
            }
            "pr-checkout" => gh(r, &["pr", "checkout", arg(a, 0)]),
            // Troca a mensagem do último commit sem incluir o que está no índice.
            "reword" => write(
                r,
                &[
                    "commit",
                    "--amend",
                    "--only",
                    "--cleanup=strip",
                    "-m",
                    arg(a, 0),
                ],
            ),
            // Junta o último commit ao anterior (os dois ainda não enviados).
            "squash-head" => {
                let lock = repo_lock(r);
                let _g = lock.lock();
                let msg = run(r, &["log", "-2", "--reverse", "--format=%B%x1e"])?;
                let parts: Vec<&str> = msg
                    .split('\x1e')
                    .map(str::trim)
                    .filter(|m| !m.is_empty())
                    .collect();
                run(r, &["reset", "--soft", "HEAD~2"])?;
                let joined = parts.join("\n\n");
                run_with(
                    r,
                    &["commit", "--cleanup=strip", "-F", "-"],
                    Some(joined.as_bytes()),
                    &[],
                )
            }
            "set-remote" => {
                if read(r, &["remote", "get-url", "origin"]).is_ok() {
                    write(r, &["remote", "set-url", "origin", arg(a, 0)])
                } else {
                    write(r, &["remote", "add", "origin", arg(a, 0)])
                }
            }
            "set-identity" => {
                write(r, &["config", "--local", "user.name", arg(a, 0)])?;
                write(r, &["config", "--local", "user.email", arg(a, 1)])
            }
            other => Err(AppError::msg(format!("ação desconhecida: {other}"))),
        }
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    index: u32,
    message: String,
    date: i64,
}

#[tauri::command]
pub async fn git_stashes(repo: String) -> AppResult<Vec<Stash>> {
    blocking(move || {
        let out = read(&repo, &["stash", "list", "--format=%gd%x1f%gs%x1f%ct"])?;
        Ok(out
            .lines()
            .filter_map(|l| {
                let f: Vec<&str> = l.split('\x1f').collect();
                let index = f
                    .first()?
                    .trim_start_matches("stash@{")
                    .trim_end_matches('}')
                    .parse()
                    .ok()?;
                Some(Stash {
                    index,
                    message: f.get(1).unwrap_or(&"").to_string(),
                    date: f.get(2).and_then(|d| d.parse().ok()).unwrap_or(0),
                })
            })
            .collect())
    })
    .await
}

// ------------------------------------------------------------------ remoto

/// fetch, pull, push, publish ou force-push, com o progresso enviado ao vivo.
#[tauri::command]
pub async fn git_remote(repo: String, op: String, progress: Channel<String>) -> AppResult<String> {
    blocking(move || {
        let args: Vec<&str> = match op.as_str() {
            "fetch" => vec!["fetch", "--all", "--prune", "--progress"],
            "pull" => vec!["pull", "--progress"],
            "push" => vec!["push", "--progress"],
            "publish" => vec!["push", "--progress", "-u", "origin", "HEAD"],
            "force-push" => vec!["push", "--progress", "--force-with-lease"],
            "push-tags" => vec!["push", "--progress", "--tags"],
            _ => return Err(AppError::msg(op)),
        };
        let lock = repo_lock(&repo);
        let _g = lock.lock();
        let mut child = command(&repo, &args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| AppError::msg(tr("projects.gitNotFound", &[])))?;
        let mut stderr = child.stderr.take().expect("stderr");
        let mut all = Vec::new();
        let mut line = Vec::new();
        let mut buf = [0u8; 2048];
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 {
                break;
            }
            all.extend_from_slice(&buf[..n]);
            for &b in &buf[..n] {
                if b == b'\r' || b == b'\n' {
                    if !line.is_empty() {
                        let _ = progress.send(String::from_utf8_lossy(&line).trim().to_string());
                        line.clear();
                    }
                } else {
                    line.push(b);
                }
            }
        }
        let mut stdout = Vec::new();
        if let Some(mut o) = child.stdout.take() {
            let _ = o.read_to_end(&mut stdout);
        }
        let status = child.wait()?;
        if status.success() {
            Ok(String::from_utf8_lossy(&stdout).trim().to_string())
        } else {
            Err(git_error(&all, &stdout))
        }
    })
    .await
}

/// Endereço web do repositório remoto (GitHub, GitLab, Azure…).
#[tauri::command]
pub async fn git_web_url(repo: String) -> Option<String> {
    blocking(move || {
        let url = read(&repo, &["remote", "get-url", "origin"])?;
        Ok(web_url(url.trim()))
    })
    .await
    .ok()
    .flatten()
}

fn web_url(remote: &str) -> Option<String> {
    let s = remote.trim_end_matches(".git");
    if let Some(rest) = s.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        return Some(format!("https://{host}/{path}"));
    }
    if let Some(rest) = s.strip_prefix("ssh://") {
        let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        let (host, path) = rest.split_once('/')?;
        let host = host.split(':').next()?;
        return Some(format!("https://{host}/{path}"));
    }
    if s.starts_with("https://") || s.starts_with("http://") {
        // Remove credenciais (https://user:token@host/...).
        let (scheme, rest) = s.split_once("://")?;
        let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        return Some(format!("{scheme}://{rest}"));
    }
    None
}

// ------------------------------------------------------------------ GitHub (gh)

fn gh(repo: &str, args: &[&str]) -> AppResult<String> {
    let program =
        crate::tools::resolve("gh").ok_or_else(|| AppError::msg(tr("git.ghMissing", &[])))?;
    let mut cmd = Command::new(&program.path);
    cmd.args(&program.prefix)
        .args(args)
        .current_dir(repo)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1");
    hide_console(&mut cmd);
    let out = cmd.output()?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(git_error(&out.stderr, &out.stdout))
    }
}

#[tauri::command]
pub async fn gh_prs(repo: String) -> AppResult<serde_json::Value> {
    blocking(move || {
        let out = gh(
            &repo,
            &[
                "pr",
                "list",
                "--limit",
                "50",
                "--json",
                "number,title,headRefName,baseRefName,author,isDraft,url,reviewDecision,statusCheckRollup,updatedAt",
            ],
        )?;
        Ok(serde_json::from_str(&out)?)
    })
    .await
}

/// Abre o navegador para criar um PR da branch atual.
#[tauri::command]
pub async fn gh_pr_create(repo: String) -> AppResult<()> {
    blocking(move || gh(&repo, &["pr", "create", "--web"]).map(|_| ())).await
}

// ------------------------------------------------------------------ IA

/// Gera a mensagem de commit com o Claude Code (`claude -p`) a partir do diff.
#[tauri::command]
pub async fn git_ai_message(repo: String) -> AppResult<String> {
    blocking(move || {
        let staged = read(&repo, &["diff", "--cached", "--no-color", "-M"])?;
        let diff = if staged.trim().is_empty() {
            let mut d = read(&repo, &["diff", "--no-color", "-M"])?;
            let untracked = read(&repo, &["ls-files", "--others", "--exclude-standard"])?;
            if !untracked.trim().is_empty() {
                d.push_str("\n# Arquivos novos:\n");
                d.push_str(&untracked);
            }
            d
        } else {
            staged
        };
        if diff.trim().is_empty() {
            return Err(AppError::msg(tr("git.nothingToCommit", &[])));
        }
        let diff: String = diff.chars().take(60_000).collect();
        let recent = read(&repo, &["log", "-n15", "--format=%s"]).unwrap_or_default();
        let prompt = format!(
            "Write a git commit message for the diff provided on stdin.\n\
             Follow the style, language and conventions of these recent commit subjects from the same repository:\n{recent}\n\
             Rules: a subject line of at most 72 characters; if useful, a blank line and a short body with bullet points. \
             Output ONLY the commit message, without quotes, code fences or explanations."
        );
        let program = crate::tools::resolve("claude").ok_or_else(|| AppError::msg(tr("git.claudeMissing", &[])))?;
        let attempt = |model: Option<&str>| -> AppResult<String> {
            let mut cmd = Command::new(&program.path);
            cmd.args(&program.prefix).arg("-p").arg(&prompt);
            if let Some(m) = model {
                cmd.args(["--model", m]);
            }
            cmd.current_dir(&repo).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
            for v in crate::pty::INHERITED_AGENT_VARS {
                cmd.env_remove(v);
            }
            hide_console(&mut cmd);
            let mut child = cmd.spawn()?;
            if let Some(mut pipe) = child.stdin.take() {
                let _ = pipe.write_all(diff.as_bytes());
            }
            let out = child.wait_with_output()?;
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if out.status.success() && !text.is_empty() {
                Ok(text.trim_matches('`').trim().to_string())
            } else {
                Err(git_error(&out.stderr, &out.stdout))
            }
        };
        attempt(Some("haiku")).or_else(|_| attempt(None))
    })
    .await
}

// ------------------------------------------------------------------ editor

/// Abre no VS Code (se instalado) ou no programa padrão do Windows.
#[tauri::command]
pub async fn open_in_editor(path: String, line: Option<u32>) -> AppResult<()> {
    blocking(move || {
        if let Some(code) = crate::tools::resolve("code") {
            let target = match line {
                Some(l) => format!("{path}:{l}"),
                None => path.clone(),
            };
            let mut cmd = Command::new(&code.path);
            cmd.args(&code.prefix).args(["-g", &target]);
            hide_console(&mut cmd);
            cmd.spawn()?;
            return Ok(());
        }
        Command::new("explorer").arg(&path).spawn()?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn editor_available() -> bool {
    crate::tools::resolve("code").is_some()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoConfig {
    remote: Option<String>,
    name: String,
    email: String,
    default_branch: Option<String>,
}

/// Remoto, identidade e branch padrão (para configurações e "atualizar a partir de main").
#[tauri::command]
pub async fn git_repo_config(repo: String) -> AppResult<RepoConfig> {
    blocking(move || {
        let get = |args: &[&str]| {
            read(&repo, args)
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let default_branch =
            get(&["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).or_else(|| {
                ["main", "master", "develop"]
                    .iter()
                    .find(|b| {
                        read(
                            &repo,
                            &["rev-parse", "--verify", "-q", &format!("refs/heads/{b}")],
                        )
                        .is_ok()
                    })
                    .map(|b| b.to_string())
            });
        Ok(RepoConfig {
            remote: get(&["remote", "get-url", "origin"]),
            name: get(&["config", "user.name"]).unwrap_or_default(),
            email: get(&["config", "user.email"]).unwrap_or_default(),
            default_branch,
        })
    })
    .await
}

#[tauri::command]
pub fn gh_available() -> bool {
    crate::tools::resolve("gh").is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let out = "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
                   1 .M N... 100644 100644 100644 a b src/app.ts\0\
                   2 R. N... 100644 100644 100644 a b R100 new name.ts\0old name.ts\0\
                   u UU N... 100644 100644 100644 100644 a b c conflito.rs\0\
                   ? novo arquivo.md\0";
        let st = parse_status(out);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!((st.ahead, st.behind), (2, 1));
        assert_eq!(st.files.len(), 4);
        assert_eq!(st.files[0].path, "src/app.ts");
        assert_eq!(st.files[0].y, "M");
        assert_eq!(st.files[1].path, "new name.ts");
        assert_eq!(st.files[1].orig.as_deref(), Some("old name.ts"));
        assert!(st.files[2].conflict);
        assert!(st.files[3].untracked);
        assert_eq!(st.files[3].path, "novo arquivo.md");
    }

    #[test]
    fn web_urls() {
        assert_eq!(
            web_url("git@github.com:a/b.git").as_deref(),
            Some("https://github.com/a/b")
        );
        assert_eq!(
            web_url("https://user:tok@github.com/a/b.git").as_deref(),
            Some("https://github.com/a/b")
        );
        assert_eq!(
            web_url("ssh://git@host:22/a/b").as_deref(),
            Some("https://host/a/b")
        );
    }

    fn temp_repo() -> String {
        let dir = std::env::temp_dir().join(format!("polvo-gitops-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let d = dir.to_string_lossy().into_owned();
        run(&d, &["init", "-q", "-b", "main"]).unwrap();
        run(&d, &["config", "user.email", "t@t"]).unwrap();
        run(&d, &["config", "user.name", "Teste"]).unwrap();
        run(&d, &["config", "core.autocrlf", "false"]).unwrap();
        d
    }

    #[test]
    fn end_to_end_flow() {
        let repo = temp_repo();
        let file = Path::new(&repo).join("a.txt");
        std::fs::write(&file, "um\ndois\n").unwrap();
        let st = status_of(&repo).unwrap();
        assert!(st.unborn);
        assert!(st.files[0].untracked);

        // Commit de tudo (nada no índice).
        let done = tauri::async_runtime::block_on(git_commit(CommitReq {
            repo: repo.clone(),
            message: "primeiro".into(),
            amend: false,
            no_verify: false,
            all: true,
            sign_off: false,
        }))
        .unwrap();
        assert_eq!(done.subject, "primeiro");
        assert!(status_of(&repo).unwrap().files.is_empty());

        // Branch nova, alteração, stash e volta.
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "create".into(),
            args: vec!["feat/x".into()],
        }))
        .unwrap();
        std::fs::write(&file, "um\ndois\ntres\n").unwrap();
        let st = status_of(&repo).unwrap();
        assert_eq!(st.branch.as_deref(), Some("feat/x"));
        assert_eq!(st.files[0].y, "M");
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "stash-push".into(),
            args: vec!["polvo:feat/x".into()],
        }))
        .unwrap();
        let stashes = tauri::async_runtime::block_on(git_stashes(repo.clone())).unwrap();
        assert_eq!(stashes.len(), 1);
        assert!(stashes[0].message.ends_with("polvo:feat/x"));
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "checkout".into(),
            args: vec!["main".into(), String::new()],
        }))
        .unwrap();
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "checkout".into(),
            args: vec!["feat/x".into(), String::new()],
        }))
        .unwrap();
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "stash-pop".into(),
            args: vec!["0".into()],
        }))
        .unwrap();
        assert_eq!(status_of(&repo).unwrap().files.len(), 1);

        // Diff, stage e commit; histórico e branches.
        let diff = tauri::async_runtime::block_on(git_diff(DiffReq {
            repo: repo.clone(),
            path: "a.txt".into(),
            orig: None,
            kind: "worktree".into(),
            sha: None,
            context: Some(3),
            ignore_ws: Some(false),
        }))
        .unwrap();
        assert!(diff.contains("+tres"));
        tauri::async_runtime::block_on(git_stage(repo.clone(), vec!["a.txt".into()])).unwrap();
        assert_eq!(status_of(&repo).unwrap().files[0].x, "M");
        tauri::async_runtime::block_on(git_commit(CommitReq {
            repo: repo.clone(),
            message: "segundo\n\ncorpo".into(),
            amend: false,
            no_verify: false,
            all: false,
            sign_off: false,
        }))
        .unwrap();
        let log =
            tauri::async_runtime::block_on(git_log(repo.clone(), 0, 10, None, None, None)).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].subject, "segundo");
        assert_eq!(log[0].body, "corpo");
        assert!(log[0].unpushed);
        let files =
            tauri::async_runtime::block_on(git_commit_files(repo.clone(), log[0].sha.clone()))
                .unwrap();
        assert_eq!(files[0].path, "a.txt");
        let branches = tauri::async_runtime::block_on(git_branches(repo.clone())).unwrap();
        assert!(branches.iter().any(|b| b.name == "feat/x" && b.current));
        assert!(branches.iter().any(|b| b.name == "main" && !b.current));

        // Editar a mensagem e juntar os dois últimos commits.
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "reword".into(),
            args: vec!["segundo editado".into()],
        }))
        .unwrap();
        let log =
            tauri::async_runtime::block_on(git_log(repo.clone(), 0, 10, None, None, None)).unwrap();
        assert_eq!(log[0].subject, "segundo editado");
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "create".into(),
            args: vec!["tmp".into()],
        }))
        .unwrap();
        std::fs::write(&file, "um\ndois\ntres\nquatro\n").unwrap();
        tauri::async_runtime::block_on(git_commit(CommitReq {
            repo: repo.clone(),
            message: "terceiro".into(),
            amend: false,
            no_verify: false,
            all: true,
            sign_off: false,
        }))
        .unwrap();
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "squash-head".into(),
            args: vec![],
        }))
        .unwrap();
        let log =
            tauri::async_runtime::block_on(git_log(repo.clone(), 0, 10, None, None, None)).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].subject, "segundo editado");
        assert!(log[0].body.contains("terceiro"));
        let cfg = tauri::async_runtime::block_on(git_repo_config(repo.clone())).unwrap();
        assert_eq!(cfg.name, "Teste");
        assert_eq!(cfg.default_branch.as_deref(), Some("main"));
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "checkout".into(),
            args: vec!["feat/x".into(), String::new()],
        }))
        .unwrap();

        // Desfazer o último commit devolve a mensagem e mantém as alterações no índice.
        let msg = tauri::async_runtime::block_on(git_undo_commit(repo.clone())).unwrap();
        assert!(msg.starts_with("segundo"));
        assert_eq!(status_of(&repo).unwrap().files[0].x, "M");

        // Stash de um arquivo só (com mensagem) e branch criada a partir dele.
        std::fs::write(Path::new(&repo).join("b.txt"), "novo\n").unwrap();
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "stash-push".into(),
            args: vec!["só b".into(), "u".into(), "b.txt".into()],
        }))
        .unwrap();
        let st = status_of(&repo).unwrap();
        assert!(st.files.iter().all(|f| f.path != "b.txt"));
        assert!(st.files.iter().any(|f| f.path == "a.txt"));
        let stashes = tauri::async_runtime::block_on(git_stashes(repo.clone())).unwrap();
        assert!(stashes[0].message.ends_with("só b"));
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "stash-push".into(),
            args: vec![String::new(), "k".into()],
        }))
        .unwrap();
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "stash-branch".into(),
            args: vec!["do-stash".into(), "1".into()],
        }))
        .unwrap();
        let st = status_of(&repo).unwrap();
        assert_eq!(st.branch.as_deref(), Some("do-stash"));
        assert!(st.files.iter().any(|f| f.path == "b.txt"));

        // Worktree com branch nova.
        let wt = format!("{repo}-wt");
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "worktree-add".into(),
            args: vec![wt.clone(), "feat/wt".into(), "new".into(), String::new()],
        }))
        .unwrap();
        assert_eq!(status_of(&wt).unwrap().branch.as_deref(), Some("feat/wt"));
        tauri::async_runtime::block_on(git_action(GitAction {
            repo: repo.clone(),
            action: "worktree-remove".into(),
            args: vec![wt.clone(), "force".into()],
        }))
        .unwrap();
        let _ = std::fs::remove_dir_all(&repo);
    }
}
