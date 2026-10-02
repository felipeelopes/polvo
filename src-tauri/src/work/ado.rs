//! Azure DevOps pela REST API (7.1): work items via WIQL + lote, sprint atual,
//! pull requests e comentários. Cada organização é buscada em paralelo e falha
//! sozinha (o erro aparece só nela).

use std::collections::{BTreeMap, BTreeSet};

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::auth::{account_bearer, ado_auth, basic, http, net};
use super::AdoOrg;
use crate::error::{AppError, AppResult};
use crate::i18n::tr;

const V: &str = "api-version=7.1";
const V_COMMENTS: &str = "api-version=7.1-preview.4";

/// Campos pedidos no lote. Alguns só existem em certos processos (Agile,
/// Scrum, CMMI); se a organização recusar, o lote é refeito sem a lista.
const FIELDS: &[&str] = &[
    "System.Id",
    "System.Title",
    "System.WorkItemType",
    "System.State",
    "System.TeamProject",
    "System.IterationPath",
    "System.Tags",
    "System.CommentCount",
    "System.ChangedDate",
    "System.CreatedDate",
    "System.ChangedBy",
    "System.AssignedTo",
    "Microsoft.VSTS.Common.Priority",
    "Microsoft.VSTS.Common.Severity",
    "Microsoft.VSTS.Common.ClosedDate",
    "Microsoft.VSTS.Scheduling.StoryPoints",
    "Microsoft.VSTS.Scheduling.Effort",
    "Microsoft.VSTS.Scheduling.Size",
    "Microsoft.VSTS.CMMI.Blocked",
];

/// Segmento de URL com caracteres especiais escapados (projetos com espaço…).
pub fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Texto entre aspas simples na WIQL.
fn wiql_str(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

struct Org {
    name: String,
    auth: String,
}

impl Org {
    fn base(&self) -> String {
        format!("https://dev.azure.com/{}", enc(&self.name))
    }

    async fn call(&self, method: Method, url: &str, body: Option<Value>) -> AppResult<Value> {
        let auth = ado_auth(&self.name, &self.auth).await?;
        request(&self.name, &auth, method, url, body).await
    }
}

async fn request(
    org: &str,
    auth: &str,
    method: Method,
    url: &str,
    body: Option<Value>,
) -> AppResult<Value> {
    let mut req = http()?
        .request(method, url)
        .header("Authorization", auth)
        .header("Accept", "application/json");
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(net)?;
    let status = res.status();
    let text = res.text().await.map_err(net)?;
    // 203 com HTML = página de login (token recusado).
    if status.as_u16() == 401 || status.as_u16() == 203 || status.as_u16() == 302 {
        return Err(AppError::msg(tr("work.adoUnauthorized", &[("org", org)])));
    }
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = v
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("Azure DevOps HTTP {status}"));
        return Err(AppError::msg(msg));
    }
    if v.is_null() {
        return Err(AppError::msg(tr("work.adoUnauthorized", &[("org", org)])));
    }
    Ok(v)
}

#[derive(Deserialize, Clone)]
pub struct Hint {
    pub org: String,
    pub project: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OrgResult {
    org: String,
    error: Option<String>,
    me: Option<Value>,
    items: Vec<Value>,
    /// Ids mexidos por mim hoje (para a linha do tempo).
    touched: Vec<i64>,
    prs: Vec<Value>,
    sprint: Option<Value>,
    /// Estados reais de cada tipo de work item, por "projeto|tipo" (minúsculas):
    /// nome, cor e categoria (Proposed, InProgress, Resolved, Completed, Removed).
    states: BTreeMap<String, Value>,
}

#[tauri::command]
pub async fn work_ado(orgs: Vec<AdoOrg>, hints: Vec<Hint>) -> Vec<OrgResult> {
    let tasks: Vec<_> = orgs
        .into_iter()
        .map(|o| {
            let hints: Vec<String> = hints
                .iter()
                .filter(|h| h.org.eq_ignore_ascii_case(&o.name))
                .map(|h| h.project.clone())
                .collect();
            tauri::async_runtime::spawn(async move {
                let org = Org {
                    name: o.name.clone(),
                    auth: o.auth.clone(),
                };
                match fetch(&org, hints).await {
                    Ok(r) => r,
                    Err(e) => OrgResult {
                        org: o.name,
                        error: Some(e.to_string()),
                        ..Default::default()
                    },
                }
            })
        })
        .collect();
    let mut out = Vec::new();
    for t in tasks {
        if let Ok(r) = t.await {
            out.push(r);
        }
    }
    out
}

async fn wiql(org: &Org, scope: &str, query: &str, top: u32) -> AppResult<Vec<i64>> {
    let v = org
        .call(
            Method::POST,
            &format!("{scope}/_apis/wit/wiql?$top={top}&{V}"),
            Some(json!({ "query": query })),
        )
        .await?;
    Ok(v.get("workItems")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|w| w.get("id")?.as_i64()).collect())
        .unwrap_or_default())
}

async fn batch(org: &Org, ids: &[i64]) -> AppResult<Vec<Value>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(200) {
        let url = format!("{}/_apis/wit/workitemsbatch?{V}", org.base());
        let body = json!({ "ids": chunk, "fields": FIELDS, "errorPolicy": "omit" });
        let v = match org.call(Method::POST, &url, Some(body)).await {
            Ok(v) => v,
            // Campo inexistente neste processo: pede todos os campos.
            Err(_) => {
                org.call(
                    Method::POST,
                    &url,
                    Some(json!({ "ids": chunk, "errorPolicy": "omit" })),
                )
                .await?
            }
        };
        if let Some(a) = v.get("value").and_then(Value::as_array) {
            out.extend(a.iter().filter(|w| !w.is_null()).map(|w| {
                let mut f = w.get("fields").cloned().unwrap_or(json!({}));
                // Descrições podem ser grandes; vêm sob demanda na gaveta.
                if let Some(m) = f.as_object_mut() {
                    m.retain(|k, _| FIELDS.contains(&k.as_str()));
                }
                json!({ "id": w.get("id"), "fields": f })
            }));
        }
    }
    Ok(out)
}

fn field<'a>(item: &'a Value, name: &str) -> Option<&'a Value> {
    item.get("fields")?.get(name)
}

async fn fetch(org: &Org, hints: Vec<String>) -> AppResult<OrgResult> {
    let base = org.base();
    let me = org
        .call(Method::GET, &format!("{base}/_apis/connectionData"), None)
        .await?;
    let me_id = me
        .pointer("/authenticatedUser/id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mine = wiql(
        org,
        &base,
        "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me \
         AND [System.State] <> 'Removed' \
         AND ([System.State] NOT IN ('Closed','Done','Completed','Cut') OR [System.ChangedDate] >= @Today - 14) \
         ORDER BY [System.ChangedDate] DESC",
        400,
    )
    .await?;
    let touched = wiql(
        org,
        &base,
        "SELECT [System.Id] FROM WorkItems WHERE [System.ChangedBy] = @Me \
         AND [System.ChangedDate] >= @Today ORDER BY [System.ChangedDate] DESC",
        50,
    )
    .await
    .unwrap_or_default();
    let ids: BTreeSet<i64> = mine.iter().chain(touched.iter()).copied().collect();
    let items = batch(org, &ids.into_iter().collect::<Vec<_>>()).await?;

    // Projetos onde procurar sprint e PRs: os dos meus itens (mais ativos
    // primeiro) e os dos repositórios locais desta organização.
    let mut weight: BTreeMap<String, usize> = BTreeMap::new();
    for it in &items {
        if let Some(p) = field(it, "System.TeamProject").and_then(Value::as_str) {
            *weight.entry(p.to_string()).or_default() += 1;
        }
    }
    let mut projects: Vec<String> = weight.keys().cloned().collect();
    projects.sort_by_key(|p| std::cmp::Reverse(weight[p]));
    for h in hints {
        if !projects.iter().any(|p| p.eq_ignore_ascii_case(&h)) {
            projects.push(h);
        }
    }
    projects.truncate(8);

    let sprint = match projects.first() {
        Some(p) => sprint(org, p).await.ok().flatten(),
        None => None,
    };
    let mut prs = Vec::new();
    if !me_id.is_empty() {
        for p in &projects {
            for (role, key) in [("mine", "creatorId"), ("review", "reviewerId")] {
                let url = format!(
                    "{base}/{}/_apis/git/pullrequests?searchCriteria.status=active&searchCriteria.{key}={me_id}&$top=50&{V}",
                    enc(p)
                );
                if let Ok(v) = org.call(Method::GET, &url, None).await {
                    for pr in v
                        .get("value")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                    {
                        prs.push(pull_request(&org.name, p, role, &me_id, pr));
                    }
                }
            }
        }
    }
    // Estados de verdade (nome, cor e categoria) de cada tipo usado, inclusive
    // em processos customizados. Uma chamada por par projeto × tipo.
    let mut pairs: BTreeSet<(String, String)> = BTreeSet::new();
    for it in &items {
        if let (Some(p), Some(t)) = (
            field(it, "System.TeamProject").and_then(Value::as_str),
            field(it, "System.WorkItemType").and_then(Value::as_str),
        ) {
            pairs.insert((p.to_string(), t.to_string()));
        }
    }
    if let Some(s) = &sprint {
        let p = s.get("project").and_then(Value::as_str).unwrap_or_default();
        for it in s
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(t) = it.get("type").and_then(Value::as_str) {
                pairs.insert((p.to_string(), t.to_string()));
            }
        }
    }
    let mut states = BTreeMap::new();
    for (p, t) in pairs.into_iter().take(40) {
        let url = format!(
            "{base}/{}/_apis/wit/workitemtypes/{}/states?{V}",
            enc(&p),
            enc(&t)
        );
        if let Ok(v) = org.call(Method::GET, &url, None).await {
            if let Some(list) = v.get("value") {
                states.insert(
                    format!("{}|{}", p.to_lowercase(), t.to_lowercase()),
                    list.clone(),
                );
            }
        }
    }
    Ok(OrgResult {
        org: org.name.clone(),
        error: None,
        me: me.get("authenticatedUser").cloned(),
        items,
        touched,
        prs,
        sprint,
        states,
    })
}

fn pull_request(org: &str, project: &str, role: &str, me: &str, pr: &Value) -> Value {
    let repo = pr
        .pointer("/repository/name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = pr.get("pullRequestId").and_then(Value::as_i64).unwrap_or(0);
    let reviewers = pr
        .get("reviewers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let votes: Vec<i64> = reviewers
        .iter()
        .filter(|r| r.get("id").and_then(Value::as_str) != Some(me))
        .filter_map(|r| r.get("vote")?.as_i64())
        .collect();
    json!({
        "org": org,
        "project": project,
        "role": role,
        "id": id,
        "title": pr.get("title"),
        "repo": repo,
        "isDraft": pr.get("isDraft"),
        "created": pr.get("creationDate"),
        "source": pr.get("sourceRefName"),
        "target": pr.get("targetRefName"),
        "mergeStatus": pr.get("mergeStatus"),
        "author": pr.pointer("/createdBy/displayName"),
        "votes": votes,
        "url": format!("https://dev.azure.com/{}/{}/_git/{}/pullrequest/{id}", enc(org), enc(project), enc(repo)),
    })
}

/// Sprint atual do time padrão do projeto, com os itens dela (todos do time),
/// para progresso e burndown.
async fn sprint(org: &Org, project: &str) -> AppResult<Option<Value>> {
    let scope = format!("{}/{}", org.base(), enc(project));
    let v = org
        .call(
            Method::GET,
            &format!("{scope}/_apis/work/teamsettings/iterations?$timeframe=current&{V}"),
            None,
        )
        .await?;
    let Some(it) = v
        .get("value")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
    else {
        return Ok(None);
    };
    let path = it.get("path").and_then(Value::as_str).unwrap_or_default();
    let ids = wiql(
        org,
        &scope,
        &format!(
            "SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = {} AND [System.State] <> 'Removed'",
            wiql_str(path)
        ),
        600,
    )
    .await?;
    let items = batch(org, &ids).await?;
    let slim: Vec<Value> = items
        .iter()
        .map(|w| {
            json!({
                "id": w.get("id"),
                "type": field(w, "System.WorkItemType"),
                "state": field(w, "System.State"),
                "points": field(w, "Microsoft.VSTS.Scheduling.StoryPoints")
                    .or_else(|| field(w, "Microsoft.VSTS.Scheduling.Effort"))
                    .or_else(|| field(w, "Microsoft.VSTS.Scheduling.Size")),
                "closed": field(w, "Microsoft.VSTS.Common.ClosedDate"),
            })
        })
        .collect();
    Ok(Some(json!({
        "org": org.name,
        "project": project,
        "name": it.get("name"),
        "path": path,
        "start": it.pointer("/attributes/startDate"),
        "finish": it.pointer("/attributes/finishDate"),
        "url": format!("{scope}/_sprints/taskboard"),
        "items": slim,
    })))
}

fn org_of(name: &str, auth: &str) -> Org {
    Org {
        name: name.to_string(),
        auth: auth.to_string(),
    }
}

/// Descrição, passos para reproduzir e comentários de um work item.
#[tauri::command]
pub async fn work_ado_thread(
    org: String,
    auth: String,
    project: String,
    id: i64,
) -> AppResult<Value> {
    let o = org_of(&org, &auth);
    let scope = format!("{}/{}", o.base(), enc(&project));
    let item = o
        .call(
            Method::GET,
            &format!("{scope}/_apis/wit/workitems/{id}?{V}"),
            None,
        )
        .await?;
    let comments = o
        .call(
            Method::GET,
            &format!("{scope}/_apis/wit/workItems/{id}/comments?$top=200&{V_COMMENTS}"),
            None,
        )
        .await?;
    let f = |k: &str| item.pointer(&format!("/fields/{k}")).cloned();
    let list: Vec<Value> = comments
        .get("comments")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|c| !c.get("isDeleted").and_then(Value::as_bool).unwrap_or(false))
                .map(|c| {
                    json!({
                        "author": c.pointer("/createdBy/displayName"),
                        "avatar": c.pointer("/createdBy/imageUrl"),
                        "html": c.get("text"),
                        "date": c.get("createdDate"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(json!({
        "description": f("System.Description"),
        "repro": f("Microsoft.VSTS.TCM.ReproSteps"),
        "acceptance": f("Microsoft.VSTS.Common.AcceptanceCriteria"),
        "comments": list,
    }))
}

#[tauri::command]
pub async fn work_ado_comment(
    org: String,
    auth: String,
    project: String,
    id: i64,
    text: String,
) -> AppResult<()> {
    let o = org_of(&org, &auth);
    let html = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\n', "<br>");
    o.call(
        Method::POST,
        &format!(
            "{}/{}/_apis/wit/workItems/{id}/comments?{V_COMMENTS}",
            o.base(),
            enc(&project)
        ),
        Some(json!({ "text": html })),
    )
    .await
    .map(|_| ())
}

/// Organizações da conta conectada (Entra ou Azure CLI).
#[tauri::command]
pub async fn work_ado_discover() -> AppResult<Vec<String>> {
    let auth = account_bearer().await?;
    let vssps = "https://app.vssps.visualstudio.com/_apis";
    let me = request(
        "",
        &auth,
        Method::GET,
        &format!("{vssps}/profile/profiles/me?{V}"),
        None,
    )
    .await?;
    let id = me.get("id").and_then(Value::as_str).unwrap_or_default();
    let accounts = request(
        "",
        &auth,
        Method::GET,
        &format!("{vssps}/accounts?memberId={id}&{V}"),
        None,
    )
    .await?;
    let mut names: Vec<String> = accounts
        .get("value")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.get("accountName")?.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

/// Valida um PAT na organização e guarda no cofre do Windows.
#[tauri::command]
pub async fn work_ado_pat_set(org: String, pat: String) -> AppResult<String> {
    let org = org.trim().trim_matches('/').to_string();
    let pat = pat.trim().to_string();
    if org.is_empty() || pat.is_empty() {
        return Err(AppError::msg(tr("work.patInvalid", &[])));
    }
    let v = request(
        &org,
        &basic(&pat),
        Method::GET,
        &format!("https://dev.azure.com/{}/_apis/connectionData", enc(&org)),
        None,
    )
    .await
    .map_err(|_| AppError::msg(tr("work.patInvalid", &[])))?;
    super::auth::pat_set(&org, &pat)?;
    Ok(v.pointer("/authenticatedUser/providerDisplayName")
        .and_then(Value::as_str)
        .unwrap_or(&org)
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapa_segmentos() {
        assert_eq!(enc("Polvo Web"), "Polvo%20Web");
        assert_eq!(enc("nox-api_2.0"), "nox-api_2.0");
        assert_eq!(enc("Ação"), "A%C3%A7%C3%A3o");
    }

    #[test]
    fn aspas_na_wiql() {
        assert_eq!(wiql_str(r"Proj\Sprint 'A'"), r"'Proj\Sprint ''A'''");
    }
}
