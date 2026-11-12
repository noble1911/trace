//! `HttpCaller` against a small MCP server on loopback: sessions, event
//! streams, paging, expiry and errors, end to end through the real transport.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tiny_http::{Header, Response, Server};

use super::*;

#[derive(Clone, Copy, Default)]
struct Mock {
    /// Gives a session id (else stateless, like Pylon's).
    stateful: bool,
    /// Answers with an event stream, a progress notification first.
    sse: bool,
    /// Forgets the first session after the handshake.
    expire_once: bool,
    /// Refuses every login.
    refuse: bool,
}

/// What the server saw of one request.
#[derive(Debug, Clone)]
struct Seen {
    method: String,
    session: Option<String>,
    version: Option<String>,
    auth: Option<String>,
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name, value).expect("header")
}

fn answer(method: &str, params: &Value) -> Value {
    match method {
        "initialize" => json!({ "protocolVersion": "2025-03-26",
            "capabilities": { "tools": {} }, "serverInfo": { "name": "mock" } }),
        "tools/list" => match params.get("cursor").and_then(Value::as_str) {
            None => json!({ "tools": [{ "name": "a" }, { "name": "b" }], "nextCursor": "p2" }),
            Some("p2") => json!({ "tools": [{ "name": "c" }], "nextCursor": "p3" }),
            _ => json!({ "tools": [{ "name": "d", "inputSchema": { "type": "object" } }] }),
        },
        _ => match params["name"].as_str() {
            Some("echo") => json!({ "content": [], "structuredContent": params["arguments"] }),
            Some("fail") => json!({ "isError": true,
                "content": [{ "type": "text", "text": "it broke" }] }),
            other => json!({ "error": format!("Unknown tool: {}", other.unwrap_or("?")) }),
        },
    }
}

/// Serve `mock` on a free port: its URL, and what it saw.
fn serve(mock: Mock) -> (String, Arc<Mutex<Vec<Seen>>>) {
    let server = Server::http("127.0.0.1:0").expect("bind");
    let port = server.server_addr().to_ip().expect("ip").port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        let (mut sessions, mut expired) = (0, false);
        let mut current: Option<String> = None;
        for mut request in server.incoming_requests() {
            let mut body = String::new();
            let _ = request.as_reader().read_to_string(&mut body);
            let msg: Value = serde_json::from_str(&body).unwrap_or_default();
            let get = |n: &str| {
                let h = request
                    .headers()
                    .iter()
                    .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(n));
                h.map(|h| h.value.to_string())
            };
            let method = msg["method"].as_str().unwrap_or_default().to_string();
            let sent_session = get("Mcp-Session-Id");
            log.lock().expect("log").push(Seen {
                method: method.clone(),
                session: sent_session.clone(),
                version: get("MCP-Protocol-Version"),
                auth: get("Authorization"),
            });
            if mock.refuse {
                let _ = request.respond(Response::empty(401));
                continue;
            }
            let mut headers = Vec::new();
            if method == "initialize" && mock.stateful {
                sessions += 1;
                current = Some(format!("s{sessions}"));
                headers.push(header("Mcp-Session-Id", &format!("s{sessions}")));
            } else if mock.stateful && sent_session != current {
                let _ = request.respond(Response::empty(404));
                continue;
            } else if mock.expire_once && !expired && !method.starts_with("notifications/") {
                expired = true;
                current = None;
                let _ = request.respond(Response::empty(404));
                continue;
            }
            let Some(id) = msg.get("id").cloned() else {
                let _ = request.respond(Response::empty(202));
                continue;
            };
            let result = answer(&method, &msg["params"]);
            let reply = match result.get("error").and_then(Value::as_str) {
                Some(e) => json!({ "jsonrpc": "2.0", "id": id,
                    "error": { "code": -32602, "message": e } }),
                None => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            };
            let text = if mock.sse {
                headers.push(header("Content-Type", "text/event-stream"));
                let progress = json!({ "jsonrpc": "2.0", "method": "notifications/progress" });
                format!("event: message\ndata: {progress}\n\nevent: message\ndata: {reply}\n\n")
            } else {
                headers.push(header("Content-Type", "application/json"));
                reply.to_string()
            };
            let mut response = Response::from_string(text);
            for h in headers {
                response.add_header(h);
            }
            let _ = request.respond(response);
        }
    });
    (format!("http://127.0.0.1:{port}/mcp"), seen)
}

fn caller(url: &str) -> HttpCaller {
    HttpCaller::new(Added {
        name: "Mock".into(),
        url: url.into(),
        auth: Auth::Key,
        key: Some(("Authorization".into(), "Bearer k".into())),
        local: false,
        remote: false,
        logo: None,
    })
}

fn methods(seen: &Arc<Mutex<Vec<Seen>>>) -> Vec<String> {
    let seen = seen.lock().expect("log");
    seen.iter().map(|s| s.method.clone()).collect()
}

#[tokio::test]
async fn a_session_is_opened_once_and_every_page_is_read() {
    let (url, seen) = serve(Mock {
        stateful: true,
        ..Mock::default()
    });
    let c = caller(&url);
    let tools = c.tools().await.expect("tools");
    let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, ["a", "b", "c", "d"]);
    assert_eq!(tools[3].input_schema, json!({ "type": "object" }));
    assert_eq!(
        c.call("echo", json!({ "x": 1 })).await,
        Ok(json!({ "x": 1 }))
    );
    let expected = [
        "initialize",
        "notifications/initialized",
        "tools/list",
        "tools/list",
        "tools/list",
        "tools/call",
    ];
    assert_eq!(methods(&seen), expected);
    let seen = seen.lock().expect("log");
    assert_eq!(seen[0].session, None, "initialize opens the session");
    assert_eq!(seen[0].version, None);
    for s in &seen[1..] {
        assert_eq!(s.session.as_deref(), Some("s1"), "{}", s.method);
        assert_eq!(
            s.version.as_deref(),
            Some("2025-03-26"),
            "the server's version"
        );
    }
    assert!(seen.iter().all(|s| s.auth.as_deref() == Some("Bearer k")));
}

#[tokio::test]
async fn a_stateless_server_streaming_events_works() {
    let (url, seen) = serve(Mock {
        sse: true,
        ..Mock::default()
    });
    let c = caller(&url);
    assert_eq!(
        c.call("echo", json!({ "q": "hi" })).await,
        Ok(json!({ "q": "hi" }))
    );
    assert_eq!(c.tools().await.expect("tools").len(), 4);
    let seen = seen.lock().expect("log");
    assert!(seen.iter().all(|s| s.session.is_none()), "no session id");
}

#[tokio::test]
async fn an_expired_session_is_reopened_once() {
    let (url, seen) = serve(Mock {
        stateful: true,
        expire_once: true,
        ..Mock::default()
    });
    let c = caller(&url);
    assert_eq!(c.call("echo", json!({})).await, Ok(json!({})));
    let expected = [
        "initialize",
        "notifications/initialized",
        "tools/call",
        "initialize",
        "notifications/initialized",
        "tools/call",
    ];
    assert_eq!(methods(&seen), expected);
    let last = seen.lock().expect("log").last().cloned().expect("a call");
    assert_eq!(last.session.as_deref(), Some("s2"));
}

#[tokio::test]
async fn errors_are_the_servers_words() {
    let (url, _) = serve(Mock::default());
    let c = caller(&url);
    assert_eq!(c.call("fail", json!({})).await, Err("it broke".into()));
    assert_eq!(
        c.call("nope", json!({})).await,
        Err("Unknown tool: nope".into())
    );
    let (url, _) = serve(Mock {
        refuse: true,
        ..Mock::default()
    });
    let refused = caller(&url).call("echo", json!({})).await.unwrap_err();
    assert!(refused.contains("Mock refused trace's login"), "{refused}");
    assert!(!refused.contains("Bearer k"), "never the token");
}

#[test]
fn a_query_endpoint_keeps_the_servers_login() {
    let c = caller("https://mcp.example.com/v2/mcp")
        .with_endpoint("https://mcp.example.com/v2/mcp?tools=all");
    assert_eq!(c.endpoint(), "https://mcp.example.com/v2/mcp?tools=all");
    assert_eq!(c.server.url, "https://mcp.example.com/v2/mcp");
    assert!(same_server("https://X.com/mcp/", "https://x.com/mcp"));
    assert_eq!(
        host_of("https://mcp.atlassian.com/v2/mcp"),
        "mcp.atlassian.com"
    );
}
