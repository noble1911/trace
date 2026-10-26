//! The MCP JSON-RPC surface: `initialize`, `tools/list`, `tools/call`, `ping`.
//! Pure functions over JSON so they can be tested without a socket or a window.

use serde_json::{json, Value};

/// What a tool call came back with: the text for the model, and whether it failed.
pub struct ToolReply {
    pub text: String,
    pub is_error: bool,
}

/// The protocol version answered when a client doesn't ask for one.
const DEFAULT_PROTOCOL: &str = "2025-06-18";

/// Told to every agent at `initialize` — what these tools are for and the rules
/// that come with them.
const INSTRUCTIONS: &str = "You are running inside trace, the desktop app that hosts this session. \
These tools act on trace itself: the issue board it shows (read tickets, move them between columns, \
comment, start a coding agent on a ticket, message running agents) and its scheduled prompts. \
To fan work out across tickets, start trace agents on them with start_agent rather than spawning \
sub-agents: each gets its own worktree, terminal and PR, and shows on the board. \
Only create a scheduled prompt when the user asks for one; it is created paused for them to switch on. \
Use update_scheduled_prompt to fix a prompt that isn't behaving as intended.";

/// Answer one JSON-RPC message. `None` for a notification (no `id`), which gets
/// no body. `call` runs a tool; it's only invoked for `tools/call`.
pub fn handle(
    message: &Value,
    tools: &[Value],
    call: impl FnOnce(&str, Value) -> ToolReply,
) -> Option<Value> {
    let id = message.get("id")?.clone();
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => Ok(initialize(&params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools })),
        "tools/call" => call_tool(&params, tools, call),
        _ => Err((-32601, format!("Method not found: {method}"))),
    };
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
    })
}

fn initialize(params: &Value) -> Value {
    let version = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_PROTOCOL);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "trace", "version": env!("CARGO_PKG_VERSION") },
        "instructions": INSTRUCTIONS,
    })
}

fn call_tool(
    params: &Value,
    tools: &[Value],
    call: impl FnOnce(&str, Value) -> ToolReply,
) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or((-32602, "Missing tool name".to_string()))?;
    let known = tools
        .iter()
        .any(|t| t.get("name").and_then(Value::as_str) == Some(name));
    if !known {
        return Err((-32602, format!("Unknown tool: {name}")));
    }
    let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let reply = call(name, arguments);
    Ok(json!({
        "content": [{ "type": "text", "text": reply.text }],
        "isError": reply.is_error,
    }))
}

#[cfg(test)]
mod tests {
    use super::{handle, ToolReply};
    use serde_json::{json, Value};

    fn tools() -> Vec<Value> {
        vec![json!({ "name": "get_board", "inputSchema": { "type": "object" } })]
    }

    fn never(_: &str, _: Value) -> ToolReply {
        panic!("no tool should run");
    }

    #[test]
    fn initialize_echoes_the_clients_protocol_and_offers_tools() {
        let msg = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2025-03-26" } });
        let out = handle(&msg, &tools(), never).unwrap();
        assert_eq!(out["result"]["protocolVersion"], "2025-03-26");
        assert!(out["result"]["capabilities"]["tools"].is_object());
        assert_eq!(out["id"], 1);
    }

    #[test]
    fn notifications_get_no_reply() {
        let msg = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        assert!(handle(&msg, &tools(), never).is_none());
    }

    #[test]
    fn calls_a_known_tool_and_wraps_its_text() {
        let msg = json!({ "jsonrpc": "2.0", "id": "a", "method": "tools/call",
            "params": { "name": "get_board", "arguments": { "x": 1 } } });
        let out = handle(&msg, &tools(), |name, args| {
            assert_eq!((name, args["x"].as_i64()), ("get_board", Some(1)));
            ToolReply { text: "3 tickets".into(), is_error: false }
        })
        .unwrap();
        assert_eq!(out["result"]["content"][0]["text"], "3 tickets");
        assert_eq!(out["result"]["isError"], false);
    }

    #[test]
    fn refuses_an_unknown_tool_without_calling_anything() {
        let msg = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "rm_rf" } });
        let out = handle(&msg, &tools(), never).unwrap();
        assert_eq!(out["error"]["code"], -32602);
    }

    #[test]
    fn unknown_methods_are_method_not_found() {
        let msg = json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/list" });
        assert_eq!(handle(&msg, &tools(), never).unwrap()["error"]["code"], -32601);
    }
}
