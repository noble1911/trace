//! Thin Jira Cloud REST client. All HTTP lives here; higher-level board/sprint
//! logic is in `board.rs`. HTTP Basic auth (email + API token).

use serde_json::Value;

use super::JiraConnection;

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("trace/0.1")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// GET `path` (absolute from the site root, e.g. `/rest/api/3/myself`) and parse JSON.
pub async fn get(conn: &JiraConnection, path: &str) -> Result<Value, String> {
    let url = format!("{}{path}", conn.base_url());
    let resp = http()?
        .get(&url)
        .basic_auth(&conn.email, Some(&conn.token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Jira request failed: {e}"))?;
    read_json(resp).await
}

/// GET `path` with query params (reqwest handles URL-encoding, e.g. JQL).
pub async fn get_query(
    conn: &JiraConnection,
    path: &str,
    query: &[(&str, &str)],
) -> Result<Value, String> {
    let url = format!("{}{path}", conn.base_url());
    let resp = http()?
        .get(&url)
        .query(query)
        .basic_auth(&conn.email, Some(&conn.token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Jira request failed: {e}"))?;
    read_json(resp).await
}

/// POST JSON `body` to `path`. Returns parsed JSON, or `Value::Null` for empty
/// (204) responses (e.g. transitions).
pub async fn post(conn: &JiraConnection, path: &str, body: Value) -> Result<Value, String> {
    let url = format!("{}{path}", conn.base_url());
    let resp = http()?
        .post(&url)
        .basic_auth(&conn.email, Some(&conn.token))
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Jira request failed: {e}"))?;
    read_json(resp).await
}

async fn read_json(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Read body failed: {e}"))?;
    if !status.is_success() {
        // Surface a concise Jira error without leaking credentials.
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("errorMessages")
                    .and_then(Value::as_array)
                    .and_then(|a| a.first())
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| {
                if status.as_u16() == 401 {
                    "Authentication failed — check your email and API token.".to_string()
                } else {
                    format!("Jira returned HTTP {}", status.as_u16())
                }
            });
        return Err(detail);
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("Invalid JSON from Jira: {e}"))
}
