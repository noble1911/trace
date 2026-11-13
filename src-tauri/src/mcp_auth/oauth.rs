//! MCP's OAuth, as a client: find the server's authorization server (RFC 9728
//! protected-resource metadata, then RFC 8414 server metadata), register with
//! it where it lets clients register themselves (RFC 7591), build the PKCE
//! authorize URL (RFC 7636, S256) naming the resource (RFC 8707), and swap a
//! code or a refresh token for tokens. Blocking; the URL-building is pure.

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::endpoints::require_https;

/// Where the browser comes back to. Fixed, so a server that can't register
/// clients itself can have trace registered with it once, with this URI.
pub const REDIRECT_PORT: u16 = 47321;
pub const REDIRECT_URI: &str = "http://127.0.0.1:47321/callback";

/// What a server's metadata says about logging in to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Discovered {
    /// The resource the tokens are for (the server's own URL, by its metadata).
    pub resource: String,
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
    pub scopes: Vec<String>,
}

/// A client trace is registered as, with one authorization server.
#[derive(Clone, PartialEq, Eq, serde::Serialize, Deserialize)]
pub struct Client {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Client({}, secret: {})",
            self.client_id,
            self.client_secret.is_some()
        )
    }
}

/// Tokens from a token endpoint.
#[derive(Deserialize)]
pub struct Tokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// Seconds from now.
    #[serde(default)]
    pub expires_in: Option<u64>,
}

fn origin_and_path(url: &str) -> Option<(String, String)> {
    let u = reqwest::Url::parse(url).ok()?;
    let origin = u.origin().ascii_serialization();
    let path = u.path().trim_end_matches('/').to_string();
    Some((origin, path))
}

/// RFC 9728's metadata URLs for `server`: with its path, then at the root.
pub fn resource_metadata_urls(server: &str) -> Vec<String> {
    let Some((origin, path)) = origin_and_path(server) else {
        return Vec::new();
    };
    let base = format!("{origin}/.well-known/oauth-protected-resource");
    if path.is_empty() {
        vec![base]
    } else {
        vec![format!("{base}{path}"), base]
    }
}

/// RFC 8414's (then OpenID's) metadata URLs for an issuer.
pub fn server_metadata_urls(issuer: &str) -> Vec<String> {
    let Some((origin, path)) = origin_and_path(issuer) else {
        return Vec::new();
    };
    vec![
        format!("{origin}/.well-known/oauth-authorization-server{path}"),
        format!("{origin}/.well-known/openid-configuration{path}"),
        format!("{issuer}/.well-known/openid-configuration"),
    ]
}

fn http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("trace")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

fn get_json(client: &reqwest::blocking::Client, url: &str) -> Option<Value> {
    let res = client.get(url).send().ok()?;
    res.status().is_success().then(|| res.json().ok()).flatten()
}

/// Find out how to log in to `server`.
pub fn discover(server: &str) -> Result<Discovered, String> {
    let client = http()?;
    let resource_meta = resource_metadata_urls(server)
        .iter()
        .find_map(|u| get_json(&client, u));
    let (resource, issuer, scopes) = match &resource_meta {
        Some(m) => (
            m["resource"].as_str().unwrap_or(server).to_string(),
            m["authorization_servers"][0].as_str().map(str::to_string),
            strings(&m["scopes_supported"]),
        ),
        None => (server.to_string(), None, Vec::new()),
    };
    // No resource metadata: the server's own origin is its authorization server.
    let issuer = issuer
        .or_else(|| origin_and_path(server).map(|(o, _)| o))
        .ok_or("That isn't a URL.")?;
    let meta = server_metadata_urls(&issuer)
        .iter()
        .find_map(|u| get_json(&client, u))
        .ok_or_else(|| format!("{issuer} doesn't say how to log in to it."))?;
    let field = |k: &str| meta[k].as_str().map(str::to_string);
    let scopes = if scopes.is_empty() {
        strings(&meta["scopes_supported"])
    } else {
        scopes
    };
    Ok(Discovered {
        resource,
        issuer: field("issuer").unwrap_or(issuer),
        authorization_endpoint: require_https(
            "authorization endpoint",
            &field("authorization_endpoint")
                .ok_or("The server's metadata has no authorization endpoint.")?,
        )?,
        token_endpoint: require_https(
            "token endpoint",
            &field("token_endpoint").ok_or("The server's metadata has no token endpoint.")?,
        )?,
        registration_endpoint: field("registration_endpoint")
            .map(|u| require_https("registration endpoint", &u))
            .transpose()?,
        scopes,
    })
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| s.as_str().map(str::to_string))
        .collect()
}

/// Whether `server` asks for a login: it answers an unauthenticated MCP
/// `initialize` with 401. A server that can't be reached counts as no.
pub fn needs_login(server: &str) -> bool {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": { "name": "trace", "version": env!("CARGO_PKG_VERSION") } } });
    http()
        .ok()
        .and_then(|c| {
            c.post(server)
                .header("Accept", "application/json, text/event-stream")
                .json(&body)
                .send()
                .ok()
        })
        .is_some_and(|r| r.status() == reqwest::StatusCode::UNAUTHORIZED)
}

/// Register trace with a server that lets clients register themselves.
pub fn register(endpoint: &str) -> Result<Client, String> {
    let body = json!({
        "client_name": "trace",
        "redirect_uris": [REDIRECT_URI],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });
    let res = http()?
        .post(endpoint)
        .json(&body)
        .send()
        .map_err(|e| format!("Couldn't register with the server: {}", e.without_url()))?;
    if !res.status().is_success() {
        return Err(format!(
            "The server refused to register trace ({}).",
            res.status()
        ));
    }
    res.json::<Client>()
        .map_err(|_| "The server's registration answer wasn't readable.".to_string())
}

/// A PKCE verifier: 64 random characters from the unreserved set.
pub fn verifier() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// The S256 challenge for a verifier.
pub fn challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Where to send the browser.
pub fn authorize_url(d: &Discovered, client: &Client, verifier: &str, state: &str) -> String {
    let mut url = match reqwest::Url::parse(&d.authorization_endpoint) {
        Ok(u) => u,
        Err(_) => return d.authorization_endpoint.clone(),
    };
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", &client.client_id);
        q.append_pair("redirect_uri", REDIRECT_URI);
        q.append_pair("code_challenge", &challenge(verifier));
        q.append_pair("code_challenge_method", "S256");
        q.append_pair("state", state);
        q.append_pair("resource", &d.resource);
        if !d.scopes.is_empty() {
            q.append_pair("scope", &d.scopes.join(" "));
        }
    }
    url.to_string()
}

fn token_request(
    token_endpoint: &str,
    client: &Client,
    mut form: Vec<(&str, String)>,
) -> Result<Tokens, String> {
    form.push(("client_id", client.client_id.clone()));
    if let Some(secret) = &client.client_secret {
        form.push(("client_secret", secret.clone()));
    }
    let res = http()?
        .post(token_endpoint)
        .form(&form)
        .send()
        .map_err(|e| format!("Couldn't reach the server: {}", e.without_url()))?;
    let status = res.status();
    if !status.is_success() {
        // The body can say why (`invalid_grant`); it never holds a token.
        let why = res
            .json::<Value>()
            .ok()
            .and_then(|v| v["error"].as_str().map(str::to_string))
            .unwrap_or_else(|| status.to_string());
        return Err(format!("The server refused: {why}."));
    }
    res.json::<Tokens>()
        .map_err(|_| "The server's token answer wasn't readable.".to_string())
}

/// Swap the code the browser brought back for tokens.
pub fn exchange(
    d: &Discovered,
    client: &Client,
    code: &str,
    verifier: &str,
) -> Result<Tokens, String> {
    token_request(
        &d.token_endpoint,
        client,
        vec![
            ("grant_type", "authorization_code".to_string()),
            ("code", code.to_string()),
            ("redirect_uri", REDIRECT_URI.to_string()),
            ("code_verifier", verifier.to_string()),
            ("resource", d.resource.clone()),
        ],
    )
}

/// New tokens for a refresh token.
pub fn refresh(
    token_endpoint: &str,
    client: &Client,
    resource: &str,
    refresh_token: &str,
) -> Result<Tokens, String> {
    token_request(
        token_endpoint,
        client,
        vec![
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh_token.to_string()),
            ("resource", resource.to_string()),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn s256_is_the_base64url_sha256_of_the_verifier() {
        // Worked out apart from this code, with Python's hashlib and base64.
        assert_eq!(
            challenge("dBjftJeZ4CVP-mJ92QQb0fJ84SV6t0rf4mI6Exb0YxE"),
            "Zt4FyxGTOU4-UC6XfqixRCylgQNcP2eNHhYL8SEpM-o"
        );
        let v = verifier();
        assert_eq!(v.len(), 64);
        assert!(v.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn metadata_is_looked_for_with_the_path_then_at_the_root() {
        assert_eq!(
            resource_metadata_urls("https://terminal.obsidianos.com/api/v1/hq/mcp"),
            [
                "https://terminal.obsidianos.com/.well-known/oauth-protected-resource/api/v1/hq/mcp",
                "https://terminal.obsidianos.com/.well-known/oauth-protected-resource",
            ]
        );
        assert_eq!(
            resource_metadata_urls("https://mcp.eu.usepylon.com/"),
            ["https://mcp.eu.usepylon.com/.well-known/oauth-protected-resource"]
        );
        assert_eq!(
            server_metadata_urls("https://mcp.sentry.dev")[0],
            "https://mcp.sentry.dev/.well-known/oauth-authorization-server"
        );
    }

    #[test]
    fn the_authorize_url_carries_pkce_state_and_the_resource() {
        let d = Discovered {
            resource: "https://mcp.sentry.dev/mcp".into(),
            issuer: "https://mcp.sentry.dev".into(),
            authorization_endpoint: "https://mcp.sentry.dev/oauth/authorize".into(),
            token_endpoint: "https://mcp.sentry.dev/oauth/token".into(),
            registration_endpoint: None,
            scopes: vec!["org:read".into(), "project:read".into()],
        };
        let client = Client {
            client_id: "abc".into(),
            client_secret: None,
        };
        let url = reqwest::Url::parse(&authorize_url(&d, &client, "v", "st")).expect("url");
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "abc");
        assert_eq!(q["redirect_uri"], REDIRECT_URI);
        assert_eq!(q["code_challenge"], challenge("v"));
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], "st");
        assert_eq!(q["resource"], "https://mcp.sentry.dev/mcp");
        assert_eq!(q["scope"], "org:read project:read");
    }

    #[test]
    fn a_client_never_shows_its_secret() {
        let c = Client {
            client_id: "id".into(),
            client_secret: Some("shh".into()),
        };
        assert!(!format!("{c:?}").contains("shh"));
    }
}

/// Against the servers configured on this machine (ignored; read-only, it
/// registers nothing): `cargo test mcp_live_discover -- --ignored --nocapture`.
#[cfg(test)]
mod live {
    #[test]
    #[ignore = "reaches the configured MCP servers"]
    fn mcp_live_discover_every_configured_server() {
        let servers = super::super::servers::discover();
        assert!(!servers.is_empty(), "no HTTP MCP servers configured here");
        for s in servers {
            match super::discover(&s.url) {
                Ok(d) => println!(
                    "{:16} issuer {:40} register {:5} scopes {:?} resource {}",
                    s.name,
                    d.issuer,
                    d.registration_endpoint.is_some(),
                    d.scopes,
                    d.resource
                ),
                Err(e) => println!("{:16} {e}", s.name),
            }
        }
    }
}
