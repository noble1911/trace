//! Integrations → MCP servers: the curated list, the HTTP servers in your
//! Claude config, and ones you add, each logged in to by trace and switched on
//! for this computer, for sandboxes, or both (`mcp_auth`). Thin wrappers;
//! anything that reaches a server runs off the async runtime. No token or key
//! is ever returned.

use tauri::AppHandle;

use crate::mcp_auth::catalog::{self, Auth};
use crate::mcp_auth::{self, flow, oauth, store, ServerStatus, Source};

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn source_of(source: &str) -> Source {
    match source {
        "catalog" => Source::Catalog,
        "config" => Source::Config,
        _ => Source::Custom,
    }
}

#[tauri::command]
pub async fn mcp_servers() -> Result<Vec<ServerStatus>, String> {
    blocking(|| Ok(mcp_auth::statuses())).await
}

/// Add one from the list: log in through the browser (OAuth), save its key,
/// or just add it (open). `client_id` is for a server that can't register
/// trace itself (the error says `needs-client-id`).
#[tauri::command]
pub async fn mcp_connect(
    app: AppHandle,
    name: String,
    url: String,
    source: String,
    client_id: Option<String>,
    key: Option<String>,
) -> Result<Vec<ServerStatus>, String> {
    blocking(move || {
        let source = source_of(&source);
        let known = catalog::by_url(&url);
        match known.map_or(Auth::Oauth, |k| k.auth) {
            Auth::Oauth => {
                flow::connect(&app, &name, &url, client_id.as_deref(), source, None)?;
            }
            auth => add_plain(
                &name,
                &url,
                auth,
                known.and_then(|k| k.key_header),
                key,
                source,
                None,
            )?,
        }
        Ok(mcp_auth::statuses())
    })
    .await
}

/// Add your own: by URL, with a name for its tools. With a key, it's sent as
/// `header`; without, trace logs in if the server asks for it, else adds it open.
/// `logo` names the service, when it's added from a self-hosted service's card.
#[tauri::command]
pub async fn mcp_add(
    app: AppHandle,
    name: String,
    url: String,
    header: Option<String>,
    key: Option<String>,
    client_id: Option<String>,
    logo: Option<String>,
) -> Result<Vec<ServerStatus>, String> {
    blocking(move || {
        let logo = logo.filter(|l| is_logo_id(l));
        let name = name.trim().to_string();
        let url = url.trim().to_string();
        if !url.starts_with("https://") {
            return Err("An MCP server's URL starts with https://.".to_string());
        }
        if crate::helpers::slugify(&name).is_empty() {
            return Err("Give it a name: its tools are called by it.".to_string());
        }
        let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
        if key.is_some() {
            add_plain(
                &name,
                &url,
                Auth::Key,
                header.as_deref(),
                key,
                Source::Custom,
                logo,
            )?;
        } else if oauth::needs_login(&url) {
            flow::connect(
                &app,
                &name,
                &url,
                client_id.as_deref(),
                Source::Custom,
                logo,
            )?;
        } else {
            add_plain(&name, &url, Auth::Open, None, None, Source::Custom, logo)?;
        }
        Ok(mcp_auth::statuses())
    })
    .await
}

/// Add a server that needs no browser: open, or a pasted key.
fn add_plain(
    name: &str,
    url: &str,
    auth: Auth,
    header: Option<&str>,
    key: Option<String>,
    source: Source,
    logo: Option<String>,
) -> Result<(), String> {
    let key = match auth {
        Auth::Key => {
            let value = key.ok_or("Paste its key first.")?;
            let header = header.unwrap_or("Authorization").trim().to_string();
            // A bare token in an Authorization header is a bearer token.
            let value = if header.eq_ignore_ascii_case("authorization") && !value.contains(' ') {
                format!("Bearer {value}")
            } else {
                value
            };
            Some((header, value))
        }
        _ => None,
    };
    let (local, remote) = mcp_auth::default_use(source);
    store::add(store::Added {
        name: name.to_string(),
        url: url.to_string(),
        auth,
        key,
        local,
        remote,
        logo,
    })
}

/// A logo id is a short slug: it only ever picks one of the renderer's icons.
fn is_logo_id(id: &str) -> bool {
    (1..=32).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Switch one on or off for this computer and for sandboxes.
#[tauri::command]
pub async fn mcp_set_use(
    url: String,
    local: bool,
    remote: bool,
) -> Result<Vec<ServerStatus>, String> {
    blocking(move || {
        store::set_use(&url, local, remote)?;
        Ok(mcp_auth::statuses())
    })
    .await
}

/// Remove one and trace's login to it (the server keeps its own record).
#[tauri::command]
pub async fn mcp_disconnect(url: String) -> Result<Vec<ServerStatus>, String> {
    blocking(move || {
        store::remove(&url)?;
        Ok(mcp_auth::statuses())
    })
    .await
}
