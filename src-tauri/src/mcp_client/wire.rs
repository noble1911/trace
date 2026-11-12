//! MCP's JSON-RPC messages, built and read as plain JSON: what the HTTP
//! transport sends and how it reads the answers. Pure, so every rule here is
//! tested without a server.

use serde_json::{json, Value};

use super::ToolInfo;

/// The MCP revision trace speaks; the server may answer with an older one,
/// which is then sent back on every request (`MCP-Protocol-Version`).
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// A JSON-RPC request.
pub fn request(id: u64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

/// A JSON-RPC notification: no id, so no answer.
pub fn notification(method: &str) -> Value {
    json!({ "jsonrpc": "2.0", "method": method })
}

/// `initialize`'s params: trace as the client, asking for no capabilities
/// (it calls tools; it offers the server nothing).
pub fn initialize_params() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": { "name": "trace", "version": env!("CARGO_PKG_VERSION") },
    })
}

/// The version the server settled on, from `initialize`'s result.
pub fn negotiated_version(result: &Value) -> String {
    result
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or(PROTOCOL_VERSION)
        .to_string()
}

/// `tools/list`'s params for one page.
pub fn tools_list_params(cursor: Option<&str>) -> Value {
    match cursor {
        Some(c) => json!({ "cursor": c }),
        None => json!({}),
    }
}

/// `tools/call`'s params.
pub fn tools_call_params(tool: &str, args: Value) -> Value {
    json!({ "name": tool, "arguments": args })
}

fn id_matches(message: &Value, id: u64) -> bool {
    match message.get("id") {
        Some(Value::Number(n)) => n.as_u64() == Some(id),
        Some(Value::String(s)) => s.parse() == Ok(id),
        _ => false,
    }
}

/// The answer to request `id` in what the server sent: one message or a
/// batch. Anything else in it (progress notifications, the server's own
/// requests) is passed over.
pub fn find_response(message: Value, id: u64) -> Option<Value> {
    let is_answer = |m: &Value| id_matches(m, id) && m.get("method").is_none();
    match message {
        Value::Array(batch) => batch.into_iter().find(is_answer),
        m if is_answer(&m) => Some(m),
        _ => None,
    }
}

/// A response's result, or the server's error message.
pub fn rpc_result(response: Value) -> Result<Value, String> {
    if let Some(error) = response.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|m| !m.is_empty());
        return Err(match message {
            Some(m) => m.to_string(),
            None => match error.get("code").and_then(Value::as_i64) {
                Some(code) => format!("The server returned error {code}."),
                None => "The server returned an error.".to_string(),
            },
        });
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| "The server's answer had no result.".to_string())
}

/// One page of `tools/list`: its tools and the cursor for the next page.
pub fn tools_page(result: &Value) -> Result<(Vec<ToolInfo>, Option<String>), String> {
    let tools = result
        .get("tools")
        .and_then(Value::as_array)
        .ok_or_else(|| "The server's tool list had no tools.".to_string())?;
    let tools = tools
        .iter()
        .filter_map(|t| {
            Some(ToolInfo {
                name: t.get("name")?.as_str()?.to_string(),
                description: t
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                input_schema: t.get("inputSchema").cloned().unwrap_or_else(|| json!({})),
            })
        })
        .collect();
    let next = result
        .get("nextCursor")
        .and_then(Value::as_str)
        .filter(|c| !c.is_empty())
        .map(str::to_string);
    Ok((tools, next))
}

/// Whether to fetch another page: there's a cursor, and it isn't the one
/// just used (a server repeating itself would loop forever).
pub fn next_cursor(used: Option<&str>, next: Option<String>) -> Option<String> {
    next.filter(|n| Some(n.as_str()) != used)
}

/// A content item as a value: a text item's text (parsed, when it's JSON),
/// any other kind (image, resource) as the server sent it.
fn content_value(item: &Value) -> Value {
    match item.get("text").and_then(Value::as_str) {
        Some(text) if item.get("type").and_then(Value::as_str) == Some("text") => {
            serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()))
        }
        _ => item.clone(),
    }
}

/// A `tools/call` result's value. Prefers `structuredContent`; else one
/// content item's value; several items come back as an array of their
/// values; none, as null. A result marked `isError` is Err with its text.
pub fn tool_value(tool: &str, result: Value) -> Result<Value, String> {
    let content = result.get("content").and_then(Value::as_array);
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        let text: Vec<&str> = content
            .into_iter()
            .flatten()
            .filter_map(|c| c.get("text").and_then(Value::as_str))
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .collect();
        return Err(if text.is_empty() {
            format!("{tool} failed.")
        } else {
            text.join("\n")
        });
    }
    if let Some(structured) = result.get("structuredContent").filter(|v| !v.is_null()) {
        return Ok(structured.clone());
    }
    Ok(match content.map(Vec::as_slice) {
        None | Some([]) => Value::Null,
        Some([one]) => content_value(one),
        Some(many) => Value::Array(many.iter().map(content_value).collect()),
    })
}

/// What to say about an HTTP error from `server`: the JSON-RPC error message
/// in its body when there is one, else the status and a short plain-text body.
pub fn http_error(server: &str, status: u16, body: &str) -> String {
    let rpc = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| rpc_result(v).err());
    if let Some(message) = rpc {
        return format!("{server}: {message}");
    }
    let body = body.trim();
    if body.is_empty() || body.starts_with('<') {
        return format!("{server} answered HTTP {status}.");
    }
    let short: String = body.chars().take(200).collect();
    format!("{server} answered HTTP {status}: {short}")
}

#[cfg(test)]
#[path = "wire_tests.rs"]
mod tests;
