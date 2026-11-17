//! Connecting trace to one MCP server: the browser half of OAuth. A one-shot
//! listener on the fixed loopback redirect waits for the server to send the
//! browser back with a code, checked against the `state` trace sent. One
//! login waits at a time (`pending`): a new one, a cancel, or the deadline
//! ends it and frees the port.

use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::oauth::{self, Client, REDIRECT_PORT};
use super::pending::{self, Ticket};
use super::store::{self, Grant};

/// Authorization servers that can't register clients themselves, with the
/// client trace was registered as there, once, for every trace: its redirect
/// is `oauth::REDIRECT_URI`, and it has no secret (a public client, PKCE).
const KNOWN_CLIENTS: &[(&str, &str)] = &[];

/// How long to wait for the browser to come back. Long enough for SSO and a
/// second factor; a login that went wrong in the browser can be cancelled
/// sooner, or is cancelled by trying again.
const WAIT: Duration = Duration::from_secs(3 * 60);
/// How often the wait looks up from the socket to see if it was cancelled.
const POLL: Duration = Duration::from_millis(250);
/// How long a new login waits for a cancelled one to let go of the port.
const PORT_FREED: Duration = Duration::from_secs(3);

/// Said when a server can't register trace and knows no client for it.
pub const NEEDS_CLIENT: &str = "needs-client-id";

/// The client to log in as at `issuer`: one already registered, the one the
/// user gave, a known one, or a new registration.
fn client(d: &oauth::Discovered, given: Option<&str>) -> Result<Client, String> {
    if let Some(id) = given.map(str::trim).filter(|s| !s.is_empty()) {
        let c = Client {
            client_id: id.to_string(),
            client_secret: None,
        };
        store::save_client(&d.issuer, &c)?;
        return Ok(c);
    }
    if let Some(c) = store::client_for(&d.issuer) {
        return Ok(c);
    }
    let known = KNOWN_CLIENTS
        .iter()
        .find(|(issuer, _)| issuer.trim_end_matches('/') == d.issuer.trim_end_matches('/'));
    if let Some((_, id)) = known {
        return Ok(Client {
            client_id: id.to_string(),
            client_secret: None,
        });
    }
    let endpoint = d.registration_endpoint.as_deref().ok_or(NEEDS_CLIENT)?;
    let c = oauth::register(endpoint)?;
    store::save_client(&d.issuer, &c)?;
    Ok(c)
}

/// Log trace in to `name` at `url` through the browser, and add it (keeping
/// its switches if it was added before). Blocking, for minutes at most: run
/// it off the async runtime.
pub fn connect(
    app: &AppHandle,
    name: &str,
    url: &str,
    client_id: Option<&str>,
    source: super::Source,
    logo: Option<String>,
) -> Result<Grant, String> {
    let grant = login(app, name, url, client_id)?;
    // Logged in: a server this one replaces goes, its switches carried over.
    let retired = super::catalog::by_url(url).map_or(&[][..], |k| k.replaces);
    let all = super::added();
    let old = all
        .iter()
        .find(|a| retired.iter().any(|r| same_url(r, &a.url)));
    if let Some(old) = old {
        store::remove(&old.url)?;
    }
    let before = all.iter().find(|a| a.url == url).or(old).cloned();
    let (local, remote) = before
        .as_ref()
        .map(|a| (a.local, a.remote))
        .unwrap_or_else(|| super::default_use(source));
    store::add(store::Added {
        name: name.to_string(),
        url: url.to_string(),
        auth: super::catalog::Auth::Oauth,
        key: None,
        local,
        remote,
        logo: logo.or_else(|| before.as_ref().and_then(|a| a.logo.clone())),
    })?;
    Ok(grant)
}

fn login(app: &AppHandle, name: &str, url: &str, client_id: Option<&str>) -> Result<Grant, String> {
    // Taken first, so a login still waiting lets go of the port while this
    // one discovers and registers.
    let ticket = pending::begin();
    let d = oauth::discover(url)?;
    let client = client(&d, client_id)?;
    let server = listen(&ticket)?;
    let verifier = oauth::verifier();
    let state = crate::helpers::new_id();
    app.opener()
        .open_url(
            oauth::authorize_url(&d, &client, &verifier, &state),
            None::<&str>,
        )
        .map_err(|e| format!("Couldn't open your browser: {e}"))?;
    let code = wait_for_code(&server, &state, &ticket)?;
    let tokens = oauth::exchange(&d, &client, &code, &verifier)?;
    let grant = store::grant_from(name, url, &d, tokens);
    store::save(&grant)?;
    Ok(grant)
}

/// The loopback listener, once a cancelled login before this one has let go
/// of the port (it looks up every `POLL`).
fn listen(ticket: &Ticket) -> Result<tiny_http::Server, String> {
    let deadline = Instant::now() + PORT_FREED;
    loop {
        if ticket.cancelled() {
            return Err(pending::CANCELLED.to_string());
        }
        match tiny_http::Server::http(("127.0.0.1", REDIRECT_PORT)) {
            Ok(server) => return Ok(server),
            Err(_) if Instant::now() < deadline => std::thread::sleep(POLL / 2),
            Err(_) => {
                return Err(format!(
                    "Port {REDIRECT_PORT} is busy: something else on this computer is using it."
                ))
            }
        }
    }
}

fn same_url(a: &str, b: &str) -> bool {
    a.trim_end_matches('/')
        .eq_ignore_ascii_case(b.trim_end_matches('/'))
}

/// The page the browser lands on.
fn page(text: &str) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>trace</title>\
         <body style=\"font-family:system-ui;padding:3em\">{text}</body>"
    );
    let header = tiny_http::Header::from_bytes("Content-Type", "text/html; charset=utf-8")
        .expect("static header");
    tiny_http::Response::from_string(html).with_header(header)
}

fn wait_for_code(
    server: &tiny_http::Server,
    state: &str,
    ticket: &Ticket,
) -> Result<String, String> {
    let deadline = Instant::now() + WAIT;
    loop {
        if ticket.cancelled() {
            return Err(pending::CANCELLED.to_string());
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(
                "The login wasn't finished in the browser in time. Check the details and connect again."
                    .to_string(),
            );
        }
        let request = match server.recv_timeout(left.min(POLL)) {
            Ok(Some(request)) => request,
            Ok(None) => continue,
            Err(e) => return Err(format!("The login listener stopped: {e}")),
        };
        let url = format!("http://127.0.0.1{}", request.url());
        let Ok(parsed) = reqwest::Url::parse(&url) else {
            let _ = request.respond(page("That wasn't a login."));
            continue;
        };
        if parsed.path() != "/callback" {
            let _ = request.respond(tiny_http::Response::empty(404));
            continue;
        }
        let q: std::collections::HashMap<String, String> =
            parsed.query_pairs().into_owned().collect();
        if q.get("state").map(String::as_str) != Some(state) {
            // Not ours: some other page, or a replay.
            let _ = request.respond(page("This login link isn't the one trace is waiting for."));
            continue;
        }
        if let Some(why) = q.get("error") {
            let _ = request.respond(page("The server said no. You can close this tab."));
            return Err(format!("The server refused the login: {why}."));
        }
        let code = q.get("code").cloned().ok_or("The server sent no code.")?;
        let _ = request.respond(page(
            "Logged in. You can close this tab and go back to trace.",
        ));
        return Ok(code);
    }
}
