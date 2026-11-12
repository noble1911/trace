//! Raw probes of Atlassian's MCP server, ignored by default: what the real
//! server answers, as shapes (keys and types, never values), with no adapter
//! in between. How to see why the adapter can't read something.
//!
//! `cargo test jira_mcp_live_shapes -- --ignored --nocapture` calls the board's
//! read tools on the login's first Jira site (or `JIRA_MCP_CLOUD_ID`), with
//! `JIRA_MCP_BOARD_ID` / `JIRA_MCP_ISSUE` for the per-board and per-issue ones.
//! `JIRA_MCP_PROBE=<file>` runs the calls in that file instead: a JSON list of
//! `{ "tool", "args", "show"?: [paths] }`, `$cloud` in an argument standing for
//! the cloudId; `show` prints the values at those dotted paths (only for
//! values that name no person or ticket: enums, counts, ids).
//!
//! **Read-only, enforced:** only the tools in [`READ_ONLY`] are ever called.
//! The login is someone's real Jira.

use serde_json::{json, Value};

use super::{endpoint, SERVER_URL};
use crate::issues::mcp_link;
use crate::mcp_client::{http, ToolCaller};

/// The only tools a probe may call: reads. Anything else is refused before
/// it reaches the server.
const READ_ONLY: &[&str] = &[
    "getAccessibleAtlassianResources",
    "getJiraCurrentUser",
    "atlassianUserInfo",
    "listJiraBoards",
    "getJiraBoardConfig",
    "listJiraBoardSprints",
    "getJiraBoardSprintData",
    "getJiraBoardIssueData",
    "listJiraStatuses",
    "searchJiraIssuesUsingJql",
    "getJiraIssue",
    "listJiraIssueTransitions",
    "listJiraIssueComments",
    "getGraphContext",
];

/// The shape of a JSON value: keys and types, never the values (so a real
/// answer can be pasted into an issue or a fixture's design without leaking
/// names or tickets). Arrays show their length and first element's shape.
pub(super) fn shape(v: &Value, depth: usize) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(_) => "bool".into(),
        Value::Number(_) => "number".into(),
        Value::String(s) => format!("string({})", s.len()),
        Value::Array(a) => match a.first() {
            Some(first) if depth > 0 => format!("[{}× {}]", a.len(), shape(first, depth - 1)),
            Some(_) => format!("[{}× …]", a.len()),
            None => "[]".into(),
        },
        Value::Object(o) if depth == 0 => format!("{{{} keys}}", o.len()),
        Value::Object(o) => {
            let fields: Vec<String> = o
                .iter()
                .map(|(k, v)| format!("{k}: {}", shape(v, depth - 1)))
                .collect();
            format!("{{{}}}", fields.join(", "))
        }
    }
}

/// The value at a dotted path (`data.values.0.type`; `*` maps over an array).
fn at(v: &Value, path: &str) -> Value {
    let Some((head, rest)) = path.split_once('.').or(Some((path, ""))) else {
        return Value::Null;
    };
    let next = match (head, v) {
        ("*", Value::Array(items)) => {
            return Value::Array(items.iter().map(|i| at(i, rest)).collect())
        }
        (_, Value::Array(items)) => head.parse::<usize>().ok().and_then(|i| items.get(i)),
        (_, Value::Object(o)) => o.get(head),
        _ => None,
    };
    match (next, rest.is_empty()) {
        (Some(n), true) => n.clone(),
        (Some(n), false) => at(n, rest),
        (None, _) => Value::Null,
    }
}

/// Call a read tool, refusing any other.
async fn read(caller: &impl ToolCaller, tool: &str, args: Value) -> Result<Value, String> {
    if !READ_ONLY.contains(&tool) {
        return Err(format!("{tool} isn't a read tool: refused"));
    }
    caller.call(tool, args).await
}

fn show(name: &str, r: &Result<Value, String>, paths: &[String]) {
    match r {
        Ok(v) => {
            println!("{name}: {}", shape(v, 7));
            for p in paths {
                println!("  {p} = {}", at(v, p));
            }
        }
        Err(e) => println!("{name}: ERROR {}", e.chars().take(400).collect::<String>()),
    }
}

/// `$cloud` in any string of `args` → the cloudId.
fn fill(args: Value, cloud: &str) -> Value {
    match args {
        Value::String(s) if s == "$cloud" => json!(cloud),
        Value::Object(o) => o.into_iter().map(|(k, v)| (k, fill(v, cloud))).collect(),
        other => other,
    }
}

#[tokio::test]
#[ignore = "reaches mcp.atlassian.com with trace's login"]
async fn jira_mcp_live_shapes() {
    if !mcp_link::logged_in(SERVER_URL) {
        println!("trace isn't logged in to {SERVER_URL}: nothing to check.");
        return;
    }
    let caller = http::for_url(&endpoint(SERVER_URL)).expect("a caller");
    let sites = read(&caller, "getAccessibleAtlassianResources", json!({})).await;
    show("getAccessibleAtlassianResources", &sites, &[]);
    let first = sites.as_ref().map(|v| at(v, "data.resources.0.cloudId"));
    let cloud = std::env::var("JIRA_MCP_CLOUD_ID")
        .ok()
        .or_else(|| first.ok().and_then(|v| v.as_str().map(str::to_string)))
        .expect("a site");
    let calls: Vec<Value> = match std::env::var("JIRA_MCP_PROBE") {
        Ok(path) => {
            let text = std::fs::read_to_string(path).expect("probe file");
            serde_json::from_str(&text).expect("probe JSON")
        }
        Err(_) => default_calls(),
    };
    for call in calls {
        let tool = call["tool"].as_str().unwrap_or_default();
        let args = fill(call.get("args").cloned().unwrap_or(json!({})), &cloud);
        let paths: Vec<String> = serde_json::from_value(call["show"].clone()).unwrap_or_default();
        show(tool, &read(&caller, tool, args).await, &paths);
    }
}

/// The board's reads, on `JIRA_MCP_BOARD_ID` and `JIRA_MCP_ISSUE` when set.
fn default_calls() -> Vec<Value> {
    let mut calls = vec![
        json!({ "tool": "getJiraCurrentUser", "args": { "cloudId": "$cloud" } }),
        json!({ "tool": "listJiraBoards", "args": { "cloudId": "$cloud" } }),
        json!({ "tool": "listJiraStatuses", "args": { "cloudId": "$cloud", "mode": "site" } }),
    ];
    if let Ok(board) = std::env::var("JIRA_MCP_BOARD_ID") {
        for tool in ["getJiraBoardConfig", "listJiraBoardSprints"] {
            calls.push(json!({ "tool": tool, "args": { "cloudId": "$cloud", "boardId": board } }));
        }
    }
    if let Ok(issue) = std::env::var("JIRA_MCP_ISSUE") {
        for tool in [
            "getJiraIssue",
            "listJiraIssueTransitions",
            "listJiraIssueComments",
        ] {
            let args = json!({ "cloudId": "$cloud", "issueIdOrKey": issue });
            calls.push(json!({ "tool": tool, "args": args }));
        }
    }
    calls
}
