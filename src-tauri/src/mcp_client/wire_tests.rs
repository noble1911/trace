use serde_json::json;

use super::*;

#[test]
fn a_request_and_a_notification_are_json_rpc() {
    assert_eq!(
        request(7, "tools/list", json!({})),
        json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/list", "params": {} })
    );
    let n = notification("notifications/initialized");
    assert_eq!(
        n,
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
    );
    assert!(n.get("id").is_none(), "a notification has no id");
}

#[test]
fn initialize_names_trace_and_the_protocol() {
    let p = initialize_params();
    assert_eq!(p["protocolVersion"], PROTOCOL_VERSION);
    assert_eq!(p["clientInfo"]["name"], "trace");
    assert_eq!(p["capabilities"], json!({}));
    assert_eq!(
        negotiated_version(&json!({ "protocolVersion": "2025-03-26" })),
        "2025-03-26"
    );
    assert_eq!(negotiated_version(&json!({})), PROTOCOL_VERSION);
}

#[test]
fn tool_params_carry_the_name_arguments_and_cursor() {
    assert_eq!(
        tools_call_params("get_me", json!({ "a": 1 })),
        json!({ "name": "get_me", "arguments": { "a": 1 } })
    );
    assert_eq!(tools_list_params(None), json!({}));
    assert_eq!(tools_list_params(Some("p2")), json!({ "cursor": "p2" }));
}

#[test]
fn the_answer_is_found_by_id_among_other_messages() {
    let progress = json!({ "jsonrpc": "2.0", "method": "notifications/progress" });
    let ping = json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" });
    let answer = json!({ "jsonrpc": "2.0", "id": 3, "result": { "ok": true } });
    assert_eq!(find_response(progress.clone(), 3), None);
    assert_eq!(
        find_response(ping.clone(), 3),
        None,
        "the server's own request"
    );
    assert_eq!(find_response(answer.clone(), 4), None, "another request's");
    assert_eq!(find_response(answer.clone(), 3), Some(answer.clone()));
    let batch = json!([progress, ping, answer.clone()]);
    assert_eq!(find_response(batch, 3), Some(answer));
    let string_id = json!({ "jsonrpc": "2.0", "id": "3", "result": {} });
    assert!(find_response(string_id, 3).is_some());
}

#[test]
fn a_json_rpc_error_is_the_servers_message() {
    let ok = json!({ "id": 1, "result": { "x": 1 } });
    assert_eq!(rpc_result(ok), Ok(json!({ "x": 1 })));
    let err = json!({ "id": 1, "error": { "code": -32602, "message": "Unknown tool: nope" } });
    assert_eq!(rpc_result(err), Err("Unknown tool: nope".to_string()));
    let bare = json!({ "id": 1, "error": { "code": -32603, "message": "" } });
    assert_eq!(
        rpc_result(bare),
        Err("The server returned error -32603.".to_string())
    );
    assert!(rpc_result(json!({ "id": 1 })).is_err());
}

#[test]
fn a_tools_page_reads_tools_and_the_next_cursor() {
    let page = json!({
        "tools": [
            { "name": "get_me", "description": "Who you are",
              "inputSchema": { "type": "object", "properties": {} } },
            { "name": "bare" },
            { "description": "no name: skipped" },
        ],
        "nextCursor": "p2",
    });
    let (tools, next) = tools_page(&page).expect("page");
    assert_eq!(tools.len(), 2);
    assert_eq!(tools[0].name, "get_me");
    assert_eq!(tools[0].description, "Who you are");
    assert_eq!(tools[0].input_schema["type"], "object");
    assert_eq!(tools[1].description, "");
    assert_eq!(tools[1].input_schema, json!({}));
    assert_eq!(next.as_deref(), Some("p2"));
    let last = json!({ "tools": [], "nextCursor": "" });
    assert_eq!(tools_page(&last).expect("page").1, None);
    assert!(tools_page(&json!({})).is_err());
}

#[test]
fn paging_stops_at_the_end_or_when_the_cursor_repeats() {
    assert_eq!(next_cursor(None, Some("p2".into())), Some("p2".into()));
    assert_eq!(
        next_cursor(Some("p2"), Some("p3".into())),
        Some("p3".into())
    );
    assert_eq!(next_cursor(Some("p2"), Some("p2".into())), None);
    assert_eq!(next_cursor(Some("p2"), None), None);
}

#[test]
fn structured_content_is_preferred() {
    let r = json!({
        "content": [{ "type": "text", "text": "{\"a\":1}" }],
        "structuredContent": { "a": 2 },
    });
    assert_eq!(tool_value("t", r), Ok(json!({ "a": 2 })));
}

#[test]
fn one_text_item_is_its_json_or_its_text() {
    let json_text = json!({ "content": [{ "type": "text", "text": "[1,2]" }] });
    assert_eq!(tool_value("t", json_text), Ok(json!([1, 2])));
    let plain = json!({ "content": [{ "type": "text", "text": "Moved." }],
                        "structuredContent": null });
    assert_eq!(tool_value("t", plain), Ok(json!("Moved.")));
}

#[test]
fn several_items_are_an_array_and_none_is_null() {
    let many = json!({ "content": [
        { "type": "text", "text": "{\"a\":1}" },
        { "type": "text", "text": "note" },
        { "type": "image", "data": "AAA", "mimeType": "image/png" },
    ] });
    assert_eq!(
        tool_value("t", many),
        Ok(json!([{ "a": 1 }, "note",
                  { "type": "image", "data": "AAA", "mimeType": "image/png" }]))
    );
    assert_eq!(tool_value("t", json!({ "content": [] })), Ok(json!(null)));
    assert_eq!(tool_value("t", json!({})), Ok(json!(null)));
}

#[test]
fn a_tool_that_failed_is_err_with_its_text() {
    let failed = json!({ "isError": true, "content": [
        { "type": "text", "text": "Issue not found " },
        { "type": "text", "text": "(PM-1)" },
    ] });
    assert_eq!(
        tool_value("get_issue", failed),
        Err("Issue not found\n(PM-1)".to_string())
    );
    let silent = json!({ "isError": true, "content": [] });
    assert_eq!(
        tool_value("get_issue", silent),
        Err("get_issue failed.".to_string())
    );
}

#[test]
fn an_http_error_says_what_the_server_said() {
    let rpc = r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"Bad session"}}"#;
    assert_eq!(http_error("Pylon", 400, rpc), "Pylon: Bad session");
    assert_eq!(
        http_error("Pylon", 500, "upstream down"),
        "Pylon answered HTTP 500: upstream down"
    );
    assert_eq!(
        http_error("Pylon", 502, "<html>Bad gateway</html>"),
        "Pylon answered HTTP 502."
    );
    let long = "x".repeat(500);
    assert!(
        http_error("Pylon", 500, &long).len() < 240,
        "a long body is cut"
    );
}
