//! GitHub direto pela API (GraphQL para as listas, REST para os comentários),
//! com o token do login do Polvo ou do GitHub CLI.

use reqwest::Method;
use serde_json::{json, Value};

use super::auth::{github_token, http, net};
use crate::error::{AppError, AppResult};
use crate::i18n::tr;

const API: &str = "https://api.github.com";

fn token() -> AppResult<String> {
    github_token()
        .map(|(t, _)| t)
        .ok_or_else(|| AppError::msg(tr("work.githubNotConnected", &[])))
}

async fn send(token: &str, req: reqwest::RequestBuilder) -> AppResult<Value> {
    let res = req
        .bearer_auth(token)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(net)?;
    let status = res.status();
    let text = res.text().await.map_err(net)?;
    if status == reqwest::StatusCode::UNAUTHORIZED {
        super::auth::github_logout_cli_cache();
        return Err(AppError::msg(tr("work.githubNotConnected", &[])));
    }
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = v
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("GitHub HTTP {status}"));
        return Err(AppError::msg(msg));
    }
    Ok(v)
}

pub async fn graphql(query: &str) -> AppResult<Value> {
    let token = token()?;
    let v = send(
        &token,
        http()?
            .post(format!("{API}/graphql"))
            .json(&json!({ "query": query })),
    )
    .await?;
    if let Some(errs) = v.get("errors").and_then(Value::as_array) {
        // Dados parciais (ex.: um repositório sem acesso) ainda servem.
        if v.get("data").is_none_or(Value::is_null) {
            let msg = errs
                .iter()
                .filter_map(|e| e.get("message").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("; ");
            return Err(AppError::msg(msg));
        }
    }
    Ok(v.get("data").cloned().unwrap_or(Value::Null))
}

pub async fn rest(method: Method, path: &str, body: Option<Value>) -> AppResult<Value> {
    let token = token()?;
    let mut req = http()?
        .request(method, format!("{API}{path}"))
        // full+json devolve também o HTML já renderizado pelo GitHub.
        .header("Accept", "application/vnd.github.full+json");
    if let Some(b) = body {
        req = req.json(&b);
    }
    send(&token, req).await
}

const ISSUE: &str = "number title url state createdAt updatedAt closedAt \
    repository { nameWithOwner } labels(first: 12) { nodes { name color } } comments { totalCount }";
const PR: &str = "number title url isDraft state createdAt updatedAt mergedAt additions deletions \
    headRefName baseRefName reviewDecision repository { nameWithOwner } author { login } comments { totalCount } \
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }";

/// Tudo de uma vez, numa consulta só: issues atribuídas (abertas e fechadas
/// recentemente), meus PRs, PRs aguardando minha revisão e PRs mesclados.
pub fn query(since: &str, issue_types: bool) -> String {
    let issue = if issue_types {
        format!("{ISSUE} issueType {{ name }}")
    } else {
        ISSUE.to_string()
    };
    let s = |alias: &str, n: u32, q: &str, frag: &str, kind: &str| {
        format!("{alias}: search(type: ISSUE, first: {n}, query: \"{q}\") {{ nodes {{ ... on {kind} {{ {frag} }} }} }}")
    };
    [
        "query { viewer { login name avatarUrl }".to_string(),
        s(
            "assigned",
            100,
            "is:issue is:open assignee:@me archived:false sort:updated-desc",
            &issue,
            "Issue",
        ),
        s(
            "closed",
            40,
            &format!("is:issue is:closed assignee:@me closed:>={since} sort:updated-desc"),
            &issue,
            "Issue",
        ),
        s(
            "mine",
            50,
            "is:pr is:open author:@me archived:false sort:updated-desc",
            PR,
            "PullRequest",
        ),
        s(
            "review",
            50,
            "is:pr is:open review-requested:@me archived:false sort:updated-desc",
            PR,
            "PullRequest",
        ),
        s(
            "merged",
            40,
            &format!("is:pr author:@me merged:>={since} sort:updated-desc"),
            PR,
            "PullRequest",
        ),
        "rateLimit { remaining resetAt } }".to_string(),
    ]
    .join(" ")
}

/// Listas do GitHub. `since` é uma data (AAAA-MM-DD) para fechados e mesclados.
#[tauri::command]
pub async fn work_github(since: String) -> AppResult<Value> {
    let since: String = since
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '-')
        .collect();
    match graphql(&query(&since, true)).await {
        // GitHub Enterprise antigo não tem tipos de issue.
        Err(e) if e.to_string().contains("issueType") => graphql(&query(&since, false)).await,
        r => r,
    }
}

fn check_repo(repo: &str) -> AppResult<()> {
    let parts: Vec<&str> = repo.split('/').collect();
    let ok = parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && !p.starts_with('.')
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        });
    if ok {
        Ok(())
    } else {
        Err(AppError::msg(format!("repo? {repo}")))
    }
}

/// Descrição e comentários de uma issue (HTML do próprio GitHub).
#[tauri::command]
pub async fn work_github_thread(repo: String, number: u64) -> AppResult<Value> {
    check_repo(&repo)?;
    let issue = rest(Method::GET, &format!("/repos/{repo}/issues/{number}"), None).await?;
    let comments = rest(
        Method::GET,
        &format!("/repos/{repo}/issues/{number}/comments?per_page=100"),
        None,
    )
    .await?;
    let pick = |v: &Value| {
        json!({
            "author": v.pointer("/user/login"),
            "avatar": v.pointer("/user/avatar_url"),
            "html": v.get("body_html"),
            "date": v.get("created_at"),
            "bot": v.pointer("/user/type").and_then(Value::as_str) == Some("Bot"),
        })
    };
    Ok(json!({
        "body": pick(&issue),
        "comments": comments.as_array().map(|a| a.iter().map(pick).collect::<Vec<_>>()).unwrap_or_default(),
    }))
}

#[tauri::command]
pub async fn work_github_comment(repo: String, number: u64, body: String) -> AppResult<()> {
    check_repo(&repo)?;
    rest(
        Method::POST,
        &format!("/repos/{repo}/issues/{number}/comments"),
        Some(json!({ "body": body })),
    )
    .await
    .map(|_| ())
}

/// Fecha (como concluída ou não planejada) ou reabre uma issue.
#[tauri::command]
pub async fn work_github_set_state(repo: String, number: u64, state: String) -> AppResult<()> {
    check_repo(&repo)?;
    let body = match state.as_str() {
        "open" => json!({ "state": "open" }),
        "not_planned" => json!({ "state": "closed", "state_reason": "not_planned" }),
        _ => json!({ "state": "closed", "state_reason": "completed" }),
    };
    rest(
        Method::PATCH,
        &format!("/repos/{repo}/issues/{number}"),
        Some(body),
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consulta_tem_todas_as_listas() {
        let q = query("2026-09-20", true);
        for alias in [
            "assigned:",
            "closed:",
            "mine:",
            "review:",
            "merged:",
            "issueType",
        ] {
            assert!(q.contains(alias), "{alias}");
        }
        assert!(q.contains("closed:>=2026-09-20"));
        assert!(!query("2026-09-20", false).contains("issueType"));
    }

    #[test]
    fn repo_valido() {
        assert!(check_repo("felipeelopes/polvo").is_ok());
        assert!(check_repo("../etc").is_err());
        assert!(check_repo("a/b/c").is_err());
    }
}
