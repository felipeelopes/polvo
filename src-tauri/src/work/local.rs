//! Commits do usuário nos repositórios locais (o "git standup") e o remoto de
//! cada um, para ligar issues e work items à pasta certa.

use std::process::Command;

use serde::Serialize;

use crate::discovery::hide_console;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalCommit {
    pub repo: String,
    pub sha: String,
    /// ms desde a época Unix.
    pub date: i64,
    pub subject: String,
    pub add: u32,
    pub del: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    /// "github" | "ado" | "other"
    pub kind: String,
    /// "dono/repo" (GitHub) ou "org/projeto/repo" (Azure DevOps), em minúsculas.
    pub slug: String,
    pub org: Option<String>,
    pub project: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub remote: Option<Remote>,
    pub user: String,
    pub email: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalWork {
    pub commits: Vec<LocalCommit>,
    pub repos: Vec<RepoInfo>,
}

fn git(repo: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(["-c", "core.quotepath=false", "-c", "color.ui=never"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0");
    hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            // Bytes, não fatia de &str: um caractere acentuado logo após o
            // `%` cortaria um caractere ao meio (pânico).
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Reconhece remotos do GitHub e do Azure DevOps (HTTPS e SSH, inclusive o
/// formato antigo `org.visualstudio.com`).
pub fn parse_remote(url: &str) -> Remote {
    let u = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let other = || Remote {
        kind: "other".into(),
        slug: u.to_lowercase(),
        org: None,
        project: None,
    };
    // Tira o esquema e credenciais: sobra "host/caminho" (ou "host:caminho" no SSH).
    let rest = u.split_once("://").map(|(_, r)| r).unwrap_or(u);
    let rest = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(rest);
    let (host, path) = match rest.split_once(['/', ':']) {
        Some(x) => x,
        None => return other(),
    };
    let host = host.to_lowercase();
    let parts: Vec<String> = path
        .split('/')
        .filter(|p| !p.is_empty())
        .map(decode)
        .collect();
    if host == "github.com" || host.ends_with(".github.com") {
        if parts.len() >= 2 {
            return Remote {
                kind: "github".into(),
                slug: format!("{}/{}", parts[0], parts[1]).to_lowercase(),
                org: Some(parts[0].clone()),
                project: None,
            };
        }
        return other();
    }
    let ado = |org: &str, project: &str, repo: &str| Remote {
        kind: "ado".into(),
        slug: format!("{org}/{project}/{repo}").to_lowercase(),
        org: Some(org.to_string()),
        project: Some(project.to_string()),
    };
    // https://dev.azure.com/org/proj/_git/repo
    if host == "dev.azure.com" {
        if let [org, project, g, repo, ..] = parts.as_slice() {
            if g == "_git" {
                return ado(org, project, repo);
            }
        }
    }
    // git@ssh.dev.azure.com:v3/org/proj/repo
    if host == "ssh.dev.azure.com" || host == "vs-ssh.visualstudio.com" {
        if let [v3, org, project, repo, ..] = parts.as_slice() {
            if v3 == "v3" {
                return ado(org, project, repo);
            }
        }
    }
    // https://org.visualstudio.com/[DefaultCollection/]proj/_git/repo
    if let Some(org) = host.strip_suffix(".visualstudio.com") {
        let p: Vec<&String> = parts
            .iter()
            .filter(|p| !p.eq_ignore_ascii_case("DefaultCollection"))
            .collect();
        if let [project, g, repo, ..] = p.as_slice() {
            if *g == "_git" {
                return ado(org, project, repo);
            }
        }
    }
    other()
}

/// " 3 files changed, 10 insertions(+), 2 deletions(-)" → (10, 2).
fn shortstat(line: &str) -> (u32, u32) {
    let mut add = 0;
    let mut del = 0;
    for part in line.split(',') {
        let p = part.trim();
        let n = p
            .split_whitespace()
            .next()
            .and_then(|n| n.parse().ok())
            .unwrap_or(0);
        if p.contains("insertion") {
            add = n;
        } else if p.contains("deletion") {
            del = n;
        }
    }
    (add, del)
}

fn parse_log(repo: &str, out: &str) -> Vec<LocalCommit> {
    out.split('\x1e')
        .filter_map(|rec| {
            let mut lines = rec.trim_matches('\n').lines();
            let head = lines.next()?;
            let f: Vec<&str> = head.split('\x1f').collect();
            if f.len() < 3 {
                return None;
            }
            let (add, del) = lines
                .find(|l| l.contains("changed"))
                .map(shortstat)
                .unwrap_or((0, 0));
            Some(LocalCommit {
                repo: repo.to_string(),
                sha: f[0].to_string(),
                date: f[1].parse::<i64>().ok()? * 1000,
                subject: f[2].to_string(),
                add,
                del,
            })
        })
        .collect()
}

fn scan(repo: &str, since_ms: i64) -> (RepoInfo, Vec<LocalCommit>) {
    let cfg = |k: &str| {
        git(repo, &["config", k])
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    let email = cfg("user.email");
    let user = cfg("user.name");
    let remote = git(repo, &["remote", "get-url", "origin"])
        .map(|u| parse_remote(&u))
        .filter(|r| !r.slug.is_empty());
    let info = RepoInfo {
        path: repo.to_string(),
        remote,
        user: user.clone(),
        email: email.clone(),
    };
    let author = if email.is_empty() { user } else { email };
    if author.is_empty() {
        return (info, vec![]);
    }
    let since = format!("--since=@{}", since_ms / 1000);
    let author = format!("--author={author}");
    let commits = git(
        repo,
        &[
            "log",
            "--all",
            "--no-merges",
            &since,
            &author,
            "--fixed-strings",
            "--pretty=format:%x1e%H%x1f%ct%x1f%s",
            "--shortstat",
        ],
    )
    .map(|out| parse_log(repo, &out))
    .unwrap_or_default();
    (info, commits)
}

/// Commits desde `since` (ms) em cada repositório, em paralelo.
#[tauri::command]
pub async fn work_local(repos: Vec<String>, since: i64) -> LocalWork {
    tauri::async_runtime::spawn_blocking(move || {
        let mut seen = std::collections::HashSet::new();
        let repos: Vec<String> = repos
            .into_iter()
            .filter(|r| seen.insert(r.to_lowercase()))
            .take(40)
            .collect();
        let results: Vec<(RepoInfo, Vec<LocalCommit>)> = std::thread::scope(|s| {
            let handles: Vec<_> = repos
                .iter()
                .map(|r| s.spawn(move || scan(r, since)))
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        let mut shas = std::collections::HashSet::new();
        let mut work = LocalWork::default();
        for (info, commits) in results {
            work.repos.push(info);
            // Worktrees do mesmo repositório repetem commits: um só por sha.
            work.commits
                .extend(commits.into_iter().filter(|c| shas.insert(c.sha.clone())));
        }
        work.commits.sort_by_key(|c| std::cmp::Reverse(c.date));
        work
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remotos() {
        let gh = parse_remote("git@github.com:FelipeeLopes/Polvo.git");
        assert_eq!(
            (gh.kind.as_str(), gh.slug.as_str()),
            ("github", "felipeelopes/polvo")
        );
        let gh = parse_remote("https://user:tok@github.com/a/b");
        assert_eq!(gh.slug, "a/b");
        let ado = parse_remote("https://nox@dev.azure.com/nox/Polvo%20Web/_git/web");
        assert_eq!(ado.kind, "ado");
        assert_eq!(ado.slug, "nox/polvo web/web");
        assert_eq!(ado.project.as_deref(), Some("Polvo Web"));
        let ssh = parse_remote("git@ssh.dev.azure.com:v3/nox/Proj/repo");
        assert_eq!(ssh.slug, "nox/proj/repo");
        let old = parse_remote("https://nox.visualstudio.com/DefaultCollection/Proj/_git/repo");
        assert_eq!(
            (old.org.as_deref(), old.slug.as_str()),
            (Some("nox"), "nox/proj/repo")
        );
        assert_eq!(parse_remote("https://gitlab.com/a/b").kind, "other");
        // "%" seguido de acento não pode derrubar o app.
        assert_eq!(
            parse_remote("https://dev.azure.com/o/Proj%ção/_git/r").kind,
            "ado"
        );
    }

    #[test]
    fn log_com_estatisticas() {
        let out = "\x1eabc\x1f1700000000\x1ffeat: x\n\n 2 files changed, 10 insertions(+), 2 deletions(-)\n\x1edef\x1f1700000100\x1fdocs\n\n 1 file changed, 1 deletion(-)\n";
        let c = parse_log("r", out);
        assert_eq!(c.len(), 2);
        assert_eq!((c[0].add, c[0].del, c[0].date), (10, 2, 1_700_000_000_000));
        assert_eq!((c[1].add, c[1].del, c[1].subject.as_str()), (0, 1, "docs"));
    }
}
