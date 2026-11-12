//! One POST to an MCP server over Streamable HTTP, and reading its answer:
//! plain JSON or an event stream, capped in size and time. The server's login
//! is added fresh on every request (`mcp_auth::auth_header`) and is never put
//! in an error or a log.

use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;

use super::sse::SseBuffer;
use super::wire;
use crate::mcp_auth::catalog::Auth;
use crate::mcp_auth::store::Added;

/// How long to wait for a connection.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// How long one call may take, answer included.
const CALL_TIMEOUT: Duration = Duration::from_secs(30);
/// The most of an answer read. Generous: a full tool list with schemas can
/// run to a few megabytes.
const MAX_BODY: usize = 16 * 1024 * 1024;

/// The session an `initialize` opened: its id (None on a stateless server)
/// and the protocol version agreed.
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub id: Option<String>,
    pub version: String,
}

/// What came back from a POST.
pub enum Reply {
    /// The JSON-RPC answer to the request sent.
    Message(Value),
    /// Nothing to read: a notification was accepted.
    Accepted,
    /// 404 to a request carrying a session id: the server forgot the
    /// session, and a new `initialize` is needed.
    Expired,
}

/// A reply, and the session id the server gave with it, if any.
pub struct Posted {
    pub reply: Reply,
    pub session_id: Option<String>,
}

/// trace's client for MCP servers, shared like `helpers::http`'s: one
/// client keeps connections open across calls. It never follows a redirect:
/// the login header (a server's own API key, say) would go with it to
/// wherever the server pointed, so a 3xx is an error instead ([`redirected`]).
fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let built = reqwest::Client::builder()
        .user_agent("trace/0.1")
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
    Ok(CLIENT.get_or_init(|| built))
}

/// `server`'s login header, fresh. Renewing an OAuth token is blocking
/// (it reads the logins file and may ask the server), so that runs off the
/// async runtime.
async fn login(server: &Added) -> Result<Option<(String, String)>, String> {
    if server.auth != Auth::Oauth {
        return crate::mcp_auth::auth_header(server);
    }
    let server = server.clone();
    tauri::async_runtime::spawn_blocking(move || crate::mcp_auth::auth_header(&server))
        .await
        .map_err(|e| format!("Couldn't read trace's login: {e}"))?
}

/// POST `body` to `endpoint` as `server`. `id` is the request's id, None for
/// a notification (whose answer isn't read).
pub async fn post(
    server: &Added,
    endpoint: &str,
    session: Option<&Session>,
    body: &Value,
    id: Option<u64>,
) -> Result<Posted, String> {
    let mut req = client()?
        .post(endpoint)
        .timeout(CALL_TIMEOUT)
        .header("Accept", "application/json, text/event-stream")
        .header("Content-Type", "application/json")
        .body(body.to_string());
    if let Some(s) = session {
        if let Some(sid) = &s.id {
            req = req.header("Mcp-Session-Id", sid);
        }
        req = req.header("MCP-Protocol-Version", &s.version);
    }
    if let Some((name, value)) = login(server).await? {
        req = req.header(name, value);
    }
    let unreachable = |e: reqwest::Error| {
        let e = e.without_url();
        if e.is_timeout() {
            format!("{} didn't answer in time.", server.name)
        } else {
            format!("Couldn't reach {}: {e}", server.name)
        }
    };
    let res = req.send().await.map_err(unreachable)?;
    let status = res.status().as_u16();
    let header = |name: &str| {
        res.headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let session_id = header("mcp-session-id");
    let is_sse = header("content-type").is_some_and(|t| t.starts_with("text/event-stream"));
    let had_session = session.is_some_and(|s| s.id.is_some());
    if status == 404 && had_session {
        return Ok(Posted {
            reply: Reply::Expired,
            session_id,
        });
    }
    if let Some(message) = redirected(&server.name, status) {
        return Err(message);
    }
    if status == 401 {
        return Err(format!(
            "{} refused trace's login. Connect it again in trace: Integrations → MCP servers.",
            server.name
        ));
    }
    if !(200..300).contains(&status) {
        let body = read_capped(res, &server.name).await.unwrap_or_default();
        return Err(wire::http_error(&server.name, status, &body));
    }
    let Some(id) = id else {
        return Ok(Posted {
            reply: Reply::Accepted,
            session_id,
        });
    };
    let message = if is_sse {
        read_sse(res, id, &server.name).await?
    } else {
        let text = read_capped(res, &server.name).await?;
        let value: Value = serde_json::from_str(&text)
            .map_err(|_| format!("{} answered with something that isn't JSON.", server.name))?;
        wire::find_response(value, id)
    };
    let message = message.ok_or_else(|| format!("{} sent no answer.", server.name))?;
    Ok(Posted {
        reply: Reply::Message(message),
        session_id,
    })
}

/// What to say when `server` answered with a redirect, which trace doesn't
/// follow (see [`client`]); None for any other status.
pub fn redirected(server: &str, status: u16) -> Option<String> {
    (300..400).contains(&status).then(|| {
        format!(
            "{server} redirected trace to another address (HTTP {status}). trace doesn't follow \
             an MCP server's redirects, so its login can't be sent elsewhere: check the server's URL."
        )
    })
}

fn too_big(server: &str) -> String {
    format!("{server}'s answer was too big to read.")
}

fn read_failed(server: &str, e: reqwest::Error) -> String {
    if e.is_timeout() {
        format!("{server} didn't answer in time.")
    } else {
        format!("Couldn't read {server}'s answer: {}", e.without_url())
    }
}

/// The whole body, up to [`MAX_BODY`].
async fn read_capped(mut res: reqwest::Response, server: &str) -> Result<String, String> {
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| read_failed(server, e))? {
        if body.len() + chunk.len() > MAX_BODY {
            return Err(too_big(server));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

/// The answer to `id` from an event stream, taken as soon as its event is
/// whole; the stream may stay open after it.
async fn read_sse(
    mut res: reqwest::Response,
    id: u64,
    server: &str,
) -> Result<Option<Value>, String> {
    let mut sse = SseBuffer::default();
    let mut read = 0;
    let answer = |events: Vec<String>| {
        events
            .iter()
            .filter_map(|data| serde_json::from_str::<Value>(data).ok())
            .find_map(|m| wire::find_response(m, id))
    };
    while let Some(chunk) = res.chunk().await.map_err(|e| read_failed(server, e))? {
        read += chunk.len();
        if read > MAX_BODY {
            return Err(too_big(server));
        }
        if let Some(found) = answer(sse.push(&chunk)) {
            return Ok(Some(found));
        }
    }
    Ok(answer(sse.finish()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_redirect_is_an_error_naming_the_server() {
        let said = redirected("Pylon", 307).expect("refused");
        assert!(said.starts_with("Pylon redirected trace to another address (HTTP 307)."));
        assert_eq!(redirected("Pylon", 200), None);
        assert_eq!(redirected("Pylon", 404), None);
    }

    #[test]
    fn the_client_doesnt_follow_redirects() {
        // A server that redirects must reach `redirected`, not be followed.
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            if let Ok((mut s, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf);
                let _ = s.write_all(
                    b"HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:1/x\r\nContent-Length: 0\r\n\r\n",
                );
            }
        });
        let status = rt.block_on(async {
            let res = client()
                .expect("client")
                .get(format!("http://127.0.0.1:{port}/mcp"))
                .send()
                .await
                .expect("answer");
            res.status().as_u16()
        });
        assert_eq!(status, 307);
    }
}
