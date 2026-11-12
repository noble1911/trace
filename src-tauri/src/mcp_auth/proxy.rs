//! The servers switched on for this computer, served on trace's loopback MCP
//! endpoint (`agent_tools::server`) at `/mcp-proxy/<name>`, the way
//! Conductor's backend serves `mcp-proxy/<id>`. A local agent's `--mcp-config`
//! points there with trace's per-app token (checked by the server); the proxy
//! drops it, adds the server's own login, fresh (an OAuth token is renewed
//! before it expires, so a long session never loses the server), and passes
//! the response back as it comes (MCP may answer with a stream of events).

use std::io::Read;
use std::sync::OnceLock;
use std::time::Duration;

use tiny_http::{Header, Request, Response, StatusCode};

use super::store::Added;

/// A JSON-RPC request is small; a bigger one is refused unread.
const MAX_BODY: u64 = 4 * 1024 * 1024;

/// Request headers MCP's HTTP transport uses, passed on as they are.
const FORWARD_UP: &[&str] = &[
    "accept",
    "content-type",
    "mcp-session-id",
    "mcp-protocol-version",
    "last-event-id",
];
/// Response headers passed back.
const FORWARD_DOWN: &[&str] = &[
    "content-type",
    "mcp-session-id",
    "mcp-protocol-version",
    "cache-control",
];

/// Split `/mcp-proxy/<slug>[/rest][?query]` into the slug and what follows it.
pub fn route(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("/mcp-proxy/")?;
    let cut = rest.find(['/', '?']).unwrap_or(rest.len());
    let (slug, tail) = rest.split_at(cut);
    (!slug.is_empty()).then(|| (slug.to_string(), tail.to_string()))
}

/// The upstream URL for a proxied request: the server's URL, plus any path
/// and query after its slug.
pub fn upstream(server_url: &str, tail: &str) -> String {
    if tail.is_empty() {
        return server_url.to_string();
    }
    match tail.strip_prefix('?') {
        Some(query) => format!("{server_url}?{query}"),
        None => format!("{}{tail}", server_url.trim_end_matches('/')),
    }
}

fn client() -> Result<&'static reqwest::blocking::Client, String> {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    // No overall timeout: a stream of events lasts as long as the server says.
    let built = reqwest::blocking::Client::builder()
        .user_agent("trace")
        .timeout(None)
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(CLIENT.get_or_init(|| built))
}

fn json_error(status: u16, message: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::json!({ "jsonrpc": "2.0", "id": null,
        "error": { "code": -32001, "message": message } });
    let header = Header::from_bytes("Content-Type", "application/json").expect("static header");
    Response::from_string(body.to_string())
        .with_status_code(status)
        .with_header(header)
}

/// Serve one proxied request (already authorised by the loopback server).
pub fn serve(request: Request) {
    serve_from(request, super::added());
}

/// [`serve`] over a given list of servers.
fn serve_from(mut request: Request, servers: Vec<Added>) {
    let Some((slug, tail)) = route(request.url()) else {
        let _ = request.respond(Response::empty(404));
        return;
    };
    let server = servers.into_iter().find(|a| a.local && a.slug() == slug);
    let Some(server) = server else {
        let _ = request.respond(json_error(
            404,
            "That MCP server isn't switched on in trace.",
        ));
        return;
    };
    let login = match super::auth_header(&server) {
        Ok(h) => h,
        Err(why) => {
            let _ = request.respond(json_error(401, &reconnect(&server, &why)));
            return;
        }
    };
    let mut body = Vec::new();
    if request
        .as_reader()
        .take(MAX_BODY)
        .read_to_end(&mut body)
        .is_err()
    {
        let _ = request.respond(Response::empty(400));
        return;
    }
    let Ok(client) = client() else {
        let _ = request.respond(Response::empty(502));
        return;
    };
    let method = reqwest::Method::from_bytes(request.method().as_str().as_bytes())
        .unwrap_or(reqwest::Method::POST);
    let mut up = client.request(method, upstream(&server.url, &tail));
    for h in request.headers() {
        let name = h.field.as_str().as_str().to_ascii_lowercase();
        if FORWARD_UP.contains(&name.as_str()) {
            up = up.header(name, h.value.as_str());
        }
    }
    if let Some((name, value)) = login {
        up = up.header(name, value);
    }
    if !body.is_empty() {
        up = up.body(body);
    }
    let res = match up.send() {
        Ok(r) => r,
        Err(e) => {
            let why = format!("Couldn't reach {}: {}", server.name, e.without_url());
            let _ = request.respond(json_error(502, &why));
            return;
        }
    };
    let status = res.status().as_u16();
    if status == 401 {
        // Not the server's own login dance: the agent can't do it, trace can.
        let why = "The server refused trace's login.";
        let _ = request.respond(json_error(401, &reconnect(&server, why)));
        return;
    }
    let headers: Vec<Header> = res
        .headers()
        .iter()
        .filter(|(k, _)| FORWARD_DOWN.contains(&k.as_str()))
        .filter_map(|(k, v)| Header::from_bytes(k.as_str(), v.as_bytes()).ok())
        .collect();
    let _ = request.respond(Response::new(StatusCode(status), headers, res, None, None));
}

fn reconnect(server: &Added, why: &str) -> String {
    format!(
        "{why} Connect {} again in trace: Integrations → MCP servers.",
        server.name
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp_auth::catalog::Auth;

    /// A proxy on a free port over `servers`, as the loopback server runs it.
    fn proxy(servers: Vec<Added>) -> u16 {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("bind");
        let port = server.server_addr().to_ip().expect("ip").port();
        std::thread::spawn(move || {
            for request in server.incoming_requests() {
                let servers = servers.clone();
                std::thread::spawn(move || serve_from(request, servers));
            }
        });
        port
    }

    fn added(name: &str, url: &str, auth: Auth, key: Option<(&str, &str)>) -> Added {
        Added {
            name: name.into(),
            url: url.into(),
            auth,
            key: key.map(|(h, v)| (h.into(), v.into())),
            local: true,
            remote: false,
            logo: None,
        }
    }

    #[test]
    #[ignore = "reaches httpbin.org and mcp.context7.com"]
    fn mcp_live_proxy_adds_the_servers_login_and_drops_traces() {
        let port = proxy(vec![
            added(
                "bin",
                "https://httpbin.org/anything",
                Auth::Key,
                Some(("Authorization", "Bearer server-key")),
            ),
            added("context7", "https://mcp.context7.com/mcp", Auth::Open, None),
            added("off", "https://httpbin.org/anything", Auth::Open, None),
        ]);
        let client = reqwest::blocking::Client::new();
        let init = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2025-06-18", "capabilities": {},
                        "clientInfo": { "name": "test", "version": "0" } } });
        let echoed = client
            .post(format!("http://127.0.0.1:{port}/mcp-proxy/bin/x?y=1"))
            .header("Authorization", "Bearer trace-app-token")
            .header("Mcp-Session-Id", "s1")
            .json(&init)
            .send()
            .expect("send")
            .text()
            .expect("text");
        println!("httpbin saw: {echoed}");
        assert!(
            echoed.contains("Bearer server-key"),
            "the server's key went up"
        );
        assert!(
            !echoed.contains("trace-app-token"),
            "trace's own token didn't"
        );
        assert!(echoed.contains("/anything/x?y=1"), "path and query kept");
        assert!(echoed.contains("s1"), "the MCP session header kept");

        let res = client
            .post(format!("http://127.0.0.1:{port}/mcp-proxy/context7"))
            .header("Accept", "application/json, text/event-stream")
            .json(&init)
            .send()
            .expect("send");
        let status = res.status();
        let body = res.text().expect("text");
        println!(
            "context7 through the proxy: {status} {}",
            &body[..body.len().min(200)]
        );
        assert!(
            status.is_success() && body.contains("serverInfo"),
            "a real MCP server answers"
        );
    }

    #[test]
    fn a_server_switched_off_here_isnt_served() {
        let mut off = added("off", "https://example.com/mcp", Auth::Open, None);
        off.local = false;
        let port = proxy(vec![off]);
        let res = reqwest::blocking::Client::new()
            .post(format!("http://127.0.0.1:{port}/mcp-proxy/off"))
            .body("{}")
            .send()
            .expect("send");
        assert_eq!(res.status().as_u16(), 404);
    }

    #[test]
    fn a_proxied_path_names_its_server_and_keeps_the_rest() {
        assert_eq!(
            route("/mcp-proxy/sentry"),
            Some(("sentry".into(), String::new()))
        );
        assert_eq!(
            route("/mcp-proxy/hq-tools/sse?x=1"),
            Some(("hq-tools".into(), "/sse?x=1".into()))
        );
        assert_eq!(
            route("/mcp-proxy/linear?s=2"),
            Some(("linear".into(), "?s=2".into()))
        );
        assert_eq!(route("/mcp-proxy/"), None);
        assert_eq!(route("/mcp"), None);
    }

    #[test]
    fn the_upstream_url_is_the_servers_plus_what_followed() {
        assert_eq!(
            upstream("https://mcp.sentry.dev/mcp", ""),
            "https://mcp.sentry.dev/mcp"
        );
        assert_eq!(
            upstream("https://mcp.vercel.com/", "/x"),
            "https://mcp.vercel.com/x"
        );
        assert_eq!(
            upstream("https://mcp.linear.app/mcp", "?s=2"),
            "https://mcp.linear.app/mcp?s=2"
        );
    }
}
