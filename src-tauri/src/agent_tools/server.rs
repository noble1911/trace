//! The loopback MCP endpoint (Streamable HTTP, JSON responses only).
//!
//! Security, as for the render bridge: bound to `127.0.0.1` only, and every
//! request must carry the per-app token (`Authorization: Bearer …`), compared in
//! constant time. It reaches agents only through their own `--mcp-config`. On top
//! of that, a request with a browser `Origin` or a `Host` that isn't this
//! loopback port is refused, so a web page can't drive it (DNS rebinding).

use std::io::Read;

use serde_json::Value;
use tauri::AppHandle;
use tiny_http::{Header, Method, Request, Response, Server};

use super::{call, defs, rpc, ToolServer};
use crate::claude::render_bridge::constant_time_eq;
use crate::helpers::new_id;

/// A JSON-RPC message is small; anything bigger is refused unread.
const MAX_BODY: u64 = 4 * 1024 * 1024;

/// Bind the listener and serve it on a plain thread (one more per request, since
/// a `tools/call` waits on the renderer).
pub fn start(app: AppHandle) -> Result<ToolServer, String> {
    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or("no loopback port")?;
    let token = new_id();
    let info = ToolServer { port, token: token.clone() };
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let (app, token) = (app.clone(), token.clone());
            std::thread::spawn(move || serve(&app, &token, port, request));
        }
    });
    Ok(info)
}

fn serve(app: &AppHandle, token: &str, port: u16, mut request: Request) {
    if !authorised(&request, token, port) {
        let _ = request.respond(Response::empty(401));
        return;
    }
    if request.url().split('?').next() != Some("/mcp") {
        let _ = request.respond(Response::empty(404));
        return;
    }
    // No server-initiated stream: GET (and anything else) isn't offered.
    if *request.method() != Method::Post {
        let _ = request.respond(Response::empty(405));
        return;
    }
    let caller = header(&request, "X-Trace-Workspace").unwrap_or_default();
    let mut body = String::new();
    if request
        .as_reader()
        .take(MAX_BODY)
        .read_to_string(&mut body)
        .is_err()
    {
        let _ = request.respond(Response::empty(400));
        return;
    }
    let Ok(message) = serde_json::from_str::<Value>(&body) else {
        let _ = request.respond(Response::empty(400));
        return;
    };
    let tools = defs(app);
    let reply = rpc::handle(&message, &tools, |name, args| call(app, name, &args, &caller));
    let response = match reply {
        // A notification or response from the client: accepted, nothing to say.
        None => Response::from_string(String::new()).with_status_code(202),
        Some(reply) => Response::from_string(reply.to_string()).with_header(json_header()),
    };
    let _ = request.respond(response);
}

fn authorised(request: &Request, token: &str, port: u16) -> bool {
    if header(request, "Origin").is_some() {
        return false;
    }
    let host_ok = header(request, "Host").is_some_and(|h| {
        h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}")
    });
    let bearer = header(request, "Authorization")
        .and_then(|h| h.strip_prefix("Bearer ").map(str::to_string))
        .unwrap_or_default();
    host_ok && constant_time_eq(bearer.as_bytes(), token.as_bytes())
}

fn header(request: &Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

fn json_header() -> Header {
    Header::from_bytes("Content-Type", "application/json").expect("static header")
}
