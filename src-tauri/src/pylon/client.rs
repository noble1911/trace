//! Thin Pylon REST client. All HTTP lives here; higher-level board logic is in
//! `board.rs`. Bearer-token auth (`Authorization: Bearer <api token>`).

use serde_json::Value;

use super::PylonConnection;

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("trace/0.1")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

fn authed(conn: &PylonConnection, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    req.bearer_auth(&conn.token).header("Accept", "application/json")
}

/// GET `path` (e.g. `/me`) and parse JSON.
pub async fn get(conn: &PylonConnection, path: &str) -> Result<Value, String> {
    let url = format!("{}{path}", conn.base_url);
    let resp = authed(conn, http()?.get(&url))
        .send()
        .await
        .map_err(|e| format!("Pylon request failed: {e}"))?;
    read_json(resp).await
}

/// GET `path` with query params.
pub async fn get_query(conn: &PylonConnection, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    let url = format!("{}{path}", conn.base_url);
    let resp = authed(conn, http()?.get(&url).query(query))
        .send()
        .await
        .map_err(|e| format!("Pylon request failed: {e}"))?;
    read_json(resp).await
}

/// POST JSON `body` to `path`.
pub async fn post(conn: &PylonConnection, path: &str, body: Value) -> Result<Value, String> {
    let url = format!("{}{path}", conn.base_url);
    let resp = authed(conn, http()?.post(&url).json(&body))
        .send()
        .await
        .map_err(|e| format!("Pylon request failed: {e}"))?;
    read_json(resp).await
}

/// PATCH JSON `body` to `path`.
pub async fn patch(conn: &PylonConnection, path: &str, body: Value) -> Result<Value, String> {
    let url = format!("{}{path}", conn.base_url);
    let resp = authed(conn, http()?.patch(&url).json(&body))
        .send()
        .await
        .map_err(|e| format!("Pylon request failed: {e}"))?;
    read_json(resp).await
}

/// Pylon wraps payloads in a top-level `"data"` key (an object for `/me`, an
/// array for lists). Unwrap it, tolerating unwrapped shapes.
pub fn data(v: &Value) -> &Value {
    v.get("data").unwrap_or(v)
}

async fn read_json(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Read body failed: {e}"))?;
    if !status.is_success() {
        // Surface a concise Pylon error without leaking the token. Pylon's
        // error shape is {"errors": ["..."]}.
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("errors")
                    .and_then(Value::as_array)
                    .and_then(|a| a.first())
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        v.get("message")
                            .or_else(|| v.get("error"))
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
            })
            .unwrap_or_else(|| {
                if status.as_u16() == 401 {
                    "Authentication failed — check your Pylon API token.".to_string()
                } else {
                    format!("Pylon returned HTTP {}", status.as_u16())
                }
            });
        return Err(detail);
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("Invalid JSON from Pylon: {e}"))
}
