//! Credenciais do "Meu trabalho", da opção mais simples à manual:
//!
//! - GitHub: login do próprio Polvo (OAuth Device Flow) ou, sem ele, o login
//!   que o GitHub CLI já tem (`gh auth token`). O CLI também serve de plano B
//!   para entrar, com o mesmo fluxo de código no navegador.
//! - Azure DevOps: Microsoft Entra ID (device code + refresh token), o token do
//!   Azure CLI (`az login`) ou um PAT para organizações sem Entra.
//!
//! Os segredos ficam só no Gerenciador de Credenciais do Windows; o webview
//! nunca vê um token.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use base64::Engine;
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::discovery::hide_console;
use crate::error::{AppError, AppResult};
use crate::i18n::tr;

/// Recurso do Azure DevOps no Microsoft Entra ID.
pub const ADO_RESOURCE: &str = "499b84ac-1321-427f-aa17-267ca6975798";
/// IDs públicos (sem segredo) dos apps OAuth do Polvo, definidos no build.
/// Sem eles, o login usa o GitHub CLI / Azure CLI, que fazem o mesmo fluxo.
pub const GITHUB_CLIENT_ID: Option<&str> = option_env!("POLVO_GITHUB_CLIENT_ID");
pub const ENTRA_CLIENT_ID: Option<&str> = option_env!("POLVO_ENTRA_CLIENT_ID");
const ENTRA: &str = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
const GITHUB_SCOPES: &str = "repo read:org read:project";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

const SERVICE: &str = "dev.polvo.app";
/// O Gerenciador de Credenciais limita cada segredo a 2560 bytes; tokens do
/// Entra podem passar disso, então são guardados em pedaços.
const CHUNK: usize = 1000;

/// Cliente HTTP compartilhado. O reqwest vem sem provedor de criptografia
/// (usamos o `ring`, já presente pelo atualizador): instala antes de criar,
/// senão a criação entra em pânico e, em release (`panic = "abort"`), fecha o app.
pub fn http() -> AppResult<&'static reqwest::Client> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            if rustls::crypto::CryptoProvider::get_default().is_none() {
                let _ = rustls::crypto::ring::default_provider().install_default();
            }
            reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .user_agent(concat!("Polvo/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(|e| AppError::msg(tr("work.network", &[("error", e)])))
}

pub fn net(e: reqwest::Error) -> AppError {
    AppError::msg(tr("work.network", &[("error", &e.to_string())]))
}

// ---------------------------------------------------------------- segredos

fn entry(key: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, key).ok()
}

pub fn secret_get(key: &str) -> Option<String> {
    let head = entry(key)?.get_password().ok()?;
    let Some(n) = head.strip_prefix("chunks:") else {
        return Some(head);
    };
    let n: usize = n.parse().ok()?;
    (0..n)
        .map(|i| entry(&format!("{key}#{i}"))?.get_password().ok())
        .collect()
}

pub fn secret_set(key: &str, value: &str) -> AppResult<()> {
    secret_del(key);
    let fail = |e: keyring::Error| AppError::msg(tr("work.vault", &[("error", &e.to_string())]));
    let head = entry(key).ok_or_else(|| AppError::msg(tr("work.vault", &[("error", key)])))?;
    if value.len() <= CHUNK {
        return head.set_password(value).map_err(fail);
    }
    let parts: Vec<&str> = value
        .as_bytes()
        .chunks(CHUNK)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect();
    for (i, p) in parts.iter().enumerate() {
        entry(&format!("{key}#{i}"))
            .ok_or_else(|| AppError::msg(tr("work.vault", &[("error", key)])))?
            .set_password(p)
            .map_err(fail)?;
    }
    head.set_password(&format!("chunks:{}", parts.len()))
        .map_err(fail)
}

pub fn secret_del(key: &str) {
    let Some(e) = entry(key) else { return };
    if let Some(n) = e.get_password().ok().and_then(|h| {
        h.strip_prefix("chunks:")
            .and_then(|n| n.parse::<usize>().ok())
    }) {
        for i in 0..n {
            if let Some(c) = entry(&format!("{key}#{i}")) {
                let _ = c.delete_credential();
            }
        }
    }
    let _ = e.delete_credential();
}

// ---------------------------------------------------------------- CLIs

pub fn cli_installed(name: &str) -> bool {
    crate::tools::resolve(name).is_some()
}

fn cli_command(name: &str, args: &[&str]) -> AppResult<Command> {
    let program = crate::tools::resolve(name)
        .ok_or_else(|| AppError::msg(tr("work.cliMissing", &[("name", name)])))?;
    let mut cmd = Command::new(&program.path);
    cmd.args(&program.prefix)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .env("AZURE_CORE_NO_COLOR", "1")
        .env("AZURE_CORE_ONLY_SHOW_ERRORS", "1");
    hide_console(&mut cmd);
    Ok(cmd)
}

pub fn cli(name: &str, args: &[&str]) -> AppResult<String> {
    let out = cli_command(name, args)?.output()?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let first = err
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string();
    Err(AppError::msg(first))
}

struct Cached(Mutex<Option<(String, Instant)>>);

impl Cached {
    const fn new() -> Self {
        Self(Mutex::new(None))
    }
    fn get(&self) -> Option<String> {
        self.0
            .lock()
            .as_ref()
            .filter(|(_, until)| Instant::now() < *until)
            .map(|(t, _)| t.clone())
    }
    fn set(&self, token: &str, ttl: Duration) {
        *self.0.lock() = Some((token.to_string(), Instant::now() + ttl));
    }
    fn clear(&self) {
        *self.0.lock() = None;
    }
}

static GH_CLI: Cached = Cached::new();
static AZ_CLI: Cached = Cached::new();
static ENTRA_ACCESS: Cached = Cached::new();

// ---------------------------------------------------------------- GitHub

/// Token do GitHub e de onde veio ("polvo" ou "gh").
pub fn github_token() -> Option<(String, &'static str)> {
    if let Some(t) = secret_get("github") {
        return Some((t, "polvo"));
    }
    if let Some(t) = GH_CLI.get() {
        return Some((t, "gh"));
    }
    let t = cli("gh", &["auth", "token", "--hostname", "github.com"]).ok()?;
    if t.is_empty() {
        return None;
    }
    GH_CLI.set(&t, Duration::from_secs(600));
    Some((t, "gh"))
}

/// O token do CLI foi recusado: busca de novo na próxima vez.
pub fn github_logout_cli_cache() {
    GH_CLI.clear();
}

pub fn github_logout() {
    secret_del("github");
    GH_CLI.clear();
}

/// Entrar no GitHub: envia `{code, url}` pelo canal assim que houver um código.
pub async fn github_login(progress: Channel<Value>) -> AppResult<()> {
    GH_CLI.clear();
    match GITHUB_CLIENT_ID {
        Some(id) => github_device(id, &progress).await,
        None => tauri::async_runtime::spawn_blocking(move || github_via_cli(&progress))
            .await
            .map_err(|e| AppError::msg(e.to_string()))?,
    }
}

#[derive(Deserialize)]
struct DeviceCode {
    device_code: String,
    user_code: String,
    #[serde(alias = "verification_url")]
    verification_uri: String,
    #[serde(default = "five")]
    interval: u64,
    #[serde(default = "fifteen_min")]
    expires_in: u64,
}

fn five() -> u64 {
    5
}

fn fifteen_min() -> u64 {
    900
}

async fn github_device(client_id: &str, progress: &Channel<Value>) -> AppResult<()> {
    let client = http()?;
    let dc: DeviceCode = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", client_id), ("scope", GITHUB_SCOPES)])
        .send()
        .await
        .map_err(net)?
        .json()
        .await
        .map_err(net)?;
    let _ = progress.send(json!({ "code": dc.user_code, "url": dc.verification_uri }));
    let token = poll(dc, |device| {
        client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id.to_string()),
                ("device_code", device),
                ("grant_type", DEVICE_GRANT.to_string()),
            ])
    })
    .await?;
    let access = token
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::msg(tr("work.loginDenied", &[])))?;
    secret_set("github", access)
}

/// Sem app OAuth próprio: o GitHub CLI faz o mesmo device flow. O código que
/// ele imprime é repassado à interface, que o mostra e abre o navegador.
fn github_via_cli(progress: &Channel<Value>) -> AppResult<()> {
    let mut cmd = cli_command(
        "gh",
        &[
            "auth",
            "login",
            "--web",
            "--hostname",
            "github.com",
            "--git-protocol",
            "https",
            "--scopes",
            "read:project",
        ],
    )?;
    cmd.env_remove("GH_PROMPT_DISABLED")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    // Mantém a entrada aberta: o gh espera um Enter antes de abrir o navegador.
    let mut stdin = child.stdin.take();
    if let Some(s) = stdin.as_mut() {
        use std::io::Write;
        let _ = s.write_all(b"\n");
    }
    let stderr = child.stderr.take();
    let p = progress.clone();
    let reader = std::thread::spawn(move || {
        let mut tail = String::new();
        let Some(err) = stderr else { return tail };
        for line in BufReader::new(err).lines().map_while(Result::ok) {
            if let Some(code) = one_time_code(&line) {
                let _ = p.send(json!({ "code": code, "url": "https://github.com/login/device" }));
            }
            tail = line;
        }
        tail
    });
    let status = child.wait()?;
    drop(stdin);
    let tail = reader.join().unwrap_or_default();
    if status.success() {
        Ok(())
    } else {
        Err(AppError::msg(if tail.trim().is_empty() {
            tr("work.loginDenied", &[])
        } else {
            tail
        }))
    }
}

/// "! First copy your one-time code: ABCD-1234" → "ABCD-1234".
fn one_time_code(line: &str) -> Option<String> {
    let (_, rest) = line.split_once("code:")?;
    let code = rest.split_whitespace().next()?;
    (code.len() == 9 && code.as_bytes()[4] == b'-').then(|| code.to_string())
}

/// Consulta o servidor no intervalo pedido até o usuário aprovar (RFC 8628).
async fn poll(
    dc: DeviceCode,
    request: impl Fn(String) -> reqwest::RequestBuilder,
) -> AppResult<Value> {
    let deadline = Instant::now() + Duration::from_secs(dc.expires_in);
    let mut interval = dc.interval.max(1);
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if Instant::now() > deadline {
            return Err(AppError::msg(tr("work.loginExpired", &[])));
        }
        let v: Value = request(dc.device_code.clone())
            .send()
            .await
            .map_err(net)?
            .json()
            .await
            .map_err(net)?;
        if v.get("access_token").is_some() {
            return Ok(v);
        }
        match v.get("error").and_then(Value::as_str).unwrap_or("") {
            "authorization_pending" => {}
            "slow_down" => interval += 5,
            "expired_token" | "code_expired" => {
                return Err(AppError::msg(tr("work.loginExpired", &[])))
            }
            "access_denied" | "authorization_declined" => {
                return Err(AppError::msg(tr("work.loginDenied", &[])))
            }
            other => {
                let desc = v
                    .get("error_description")
                    .and_then(Value::as_str)
                    .unwrap_or(other);
                return Err(AppError::msg(desc.to_string()));
            }
        }
    }
}

// ---------------------------------------------------------------- Azure DevOps

/// Entrar na Microsoft (Entra ID) ou, sem app próprio, pelo Azure CLI.
/// Devolve a conta conectada.
pub async fn ado_login(progress: Channel<Value>) -> AppResult<Option<String>> {
    match ENTRA_CLIENT_ID {
        Some(id) => entra_device(id, &progress).await.map(Some),
        None => tauri::async_runtime::spawn_blocking(move || {
            let _ = progress.send(json!({ "browser": true }));
            cli(
                "az",
                &[
                    "login",
                    "--allow-no-subscriptions",
                    "--only-show-errors",
                    "-o",
                    "none",
                ],
            )?;
            AZ_CLI.clear();
            Ok(az_user())
        })
        .await
        .map_err(|e| AppError::msg(e.to_string()))?,
    }
}

pub fn ado_logout() {
    secret_del("entra");
    ENTRA_ACCESS.clear();
    AZ_CLI.clear();
}

fn entra_scope() -> String {
    format!("{ADO_RESOURCE}/.default offline_access openid profile")
}

async fn entra_device(client_id: &str, progress: &Channel<Value>) -> AppResult<String> {
    let scope = entra_scope();
    let client = http()?;
    let dc: DeviceCode = client
        .post(format!("{ENTRA}/devicecode"))
        .form(&[("client_id", client_id), ("scope", scope.as_str())])
        .send()
        .await
        .map_err(net)?
        .json()
        .await
        .map_err(net)?;
    let _ = progress.send(json!({ "code": dc.user_code, "url": dc.verification_uri }));
    let token = poll(dc, |device| {
        client.post(format!("{ENTRA}/token")).form(&[
            ("client_id", client_id.to_string()),
            ("device_code", device),
            ("grant_type", DEVICE_GRANT.to_string()),
        ])
    })
    .await?;
    keep_entra(&token)?;
    Ok(account_of(&token).unwrap_or_default())
}

fn keep_entra(token: &Value) -> AppResult<()> {
    let access = token
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::msg(tr("work.loginDenied", &[])))?;
    let ttl = token
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(3600);
    ENTRA_ACCESS.set(access, Duration::from_secs(ttl.saturating_sub(120)));
    if let Some(r) = token.get("refresh_token").and_then(Value::as_str) {
        secret_set("entra", r)?;
    }
    Ok(())
}

/// Nome da conta no id_token (sem validar: só para mostrar na interface).
fn account_of(token: &Value) -> Option<String> {
    let jwt = token.get("id_token")?.as_str()?;
    let payload = jwt.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    ["preferred_username", "email", "name"]
        .iter()
        .find_map(|k| claims.get(*k).and_then(Value::as_str))
        .map(str::to_string)
}

pub fn entra_connected() -> bool {
    ENTRA_CLIENT_ID.is_some() && secret_get("entra").is_some()
}

async fn entra_access() -> AppResult<String> {
    if let Some(t) = ENTRA_ACCESS.get() {
        return Ok(t);
    }
    let (Some(client_id), Some(refresh)) = (ENTRA_CLIENT_ID, secret_get("entra")) else {
        return Err(AppError::msg(tr("work.adoNotConnected", &[])));
    };
    let scope = entra_scope();
    let v: Value = http()?
        .post(format!("{ENTRA}/token"))
        .form(&[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("scope", scope.as_str()),
        ])
        .send()
        .await
        .map_err(net)?
        .json()
        .await
        .map_err(net)?;
    if v.get("access_token").is_none() {
        // Refresh token expirado ou revogado: precisa entrar de novo.
        secret_del("entra");
        return Err(AppError::msg(tr("work.adoNotConnected", &[])));
    }
    keep_entra(&v)?;
    Ok(ENTRA_ACCESS.get().unwrap_or_default())
}

pub fn az_user() -> Option<String> {
    cli(
        "az",
        &["account", "show", "--query", "user.name", "-o", "tsv"],
    )
    .ok()
    .filter(|s| !s.is_empty())
}

fn az_access() -> AppResult<String> {
    if let Some(t) = AZ_CLI.get() {
        return Ok(t);
    }
    let t = cli(
        "az",
        &[
            "account",
            "get-access-token",
            "--resource",
            ADO_RESOURCE,
            "--query",
            "accessToken",
            "-o",
            "tsv",
        ],
    )
    .map_err(|_| AppError::msg(tr("work.adoNotConnected", &[])))?;
    // Tokens do az valem ~1 h; renova antes.
    AZ_CLI.set(&t, Duration::from_secs(45 * 60));
    Ok(t)
}

/// Token de acesso de conta (Entra ou Azure CLI), o que estiver disponível.
pub async fn account_bearer() -> AppResult<String> {
    if entra_connected() {
        return entra_access().await.map(|t| format!("Bearer {t}"));
    }
    let t = tauri::async_runtime::spawn_blocking(az_access)
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    Ok(format!("Bearer {t}"))
}

fn pat_key(org: &str) -> String {
    format!("ado-pat:{}", org.to_lowercase())
}

pub fn pat_set(org: &str, pat: &str) -> AppResult<()> {
    secret_set(&pat_key(org), pat)
}

pub fn pat_del(org: &str) {
    secret_del(&pat_key(org));
}

/// Cabeçalho Authorization para uma organização.
pub async fn ado_auth(org: &str, auth: &str) -> AppResult<String> {
    if auth == "pat" {
        let pat = secret_get(&pat_key(org))
            .ok_or_else(|| AppError::msg(tr("work.patMissing", &[("org", org)])))?;
        return Ok(basic(&pat));
    }
    account_bearer().await
}

pub fn basic(pat: &str) -> String {
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(format!(":{pat}"))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codigo_do_gh() {
        assert_eq!(
            one_time_code("! First copy your one-time code: AB12-CD34").as_deref(),
            Some("AB12-CD34")
        );
        assert_eq!(one_time_code("Press Enter to open github.com"), None);
    }

    #[test]
    fn conta_do_id_token() {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"preferred_username":"ana@contoso.com"}"#);
        let tok = json!({ "id_token": format!("x.{payload}.y") });
        assert_eq!(account_of(&tok).as_deref(), Some("ana@contoso.com"));
    }

    #[test]
    fn cliente_http_sem_panico() {
        assert!(http().is_ok());
    }

    #[test]
    fn pat_basico() {
        assert_eq!(basic("abc"), "Basic OmFiYw==");
    }
}
