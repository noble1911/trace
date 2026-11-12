//! Live checks against real MCP servers, ignored by default.
//!
//! `cargo test mcp_live_tools -- --ignored --nocapture` lists every tool, with
//! its input schema, of every server logged in to in trace (Integrations →
//! MCP servers): how the MCP issue providers learn the real argument shapes.
//! `MCP_LIVE_ONLY=atlassian` limits it to servers whose name or URL contains
//! that. Atlassian's v2 server is also listed with `?tools=all`, which shows
//! every tool rather than its `discover`/`execute*` front.
//!
//! `cargo test mcp_live_open_server -- --ignored --nocapture` runs the whole
//! client against context7, which needs no login.

use serde_json::{json, Value};

use super::http::HttpCaller;
use super::{ToolCaller, ToolInfo};
use crate::mcp_auth::catalog::Auth;
use crate::mcp_auth::store::{self, Added};

/// Whether trace holds a login for `server`.
fn logged_in(server: &Added, grants: &[store::Grant]) -> bool {
    match server.auth {
        Auth::Oauth => grants.iter().any(|g| g.url == server.url),
        Auth::Key => server.key.is_some(),
        Auth::Open => false,
    }
}

/// The URLs to list `server` at.
fn endpoints(server: &Added) -> Vec<String> {
    let mut urls = vec![server.url.clone()];
    if server.url.contains("mcp.atlassian.com/v2/") {
        urls.push(format!("{}?tools=all", server.url.trim_end_matches('/')));
    }
    urls
}

fn first_line(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty());
    let line = line.unwrap_or_default();
    let mut short: String = line.chars().take(160).collect();
    if short.len() < line.len() {
        short.push('…');
    }
    short
}

fn print_tools(tools: &[ToolInfo]) {
    println!("{} tools", tools.len());
    for t in tools {
        println!("\n- {}: {}", t.name, first_line(&t.description));
        println!("  {}", t.input_schema);
    }
}

#[tokio::test]
#[ignore = "reaches the MCP servers logged in to in trace"]
async fn mcp_live_tools() {
    let grants = store::grants();
    let only = std::env::var("MCP_LIVE_ONLY")
        .ok()
        .map(|s| s.to_lowercase());
    let servers: Vec<Added> = crate::mcp_auth::added()
        .into_iter()
        .filter(|s| logged_in(s, &grants))
        .filter(|s| {
            only.as_deref().is_none_or(|o| {
                s.name.to_lowercase().contains(o) || s.url.to_lowercase().contains(o)
            })
        })
        .collect();
    if servers.is_empty() {
        println!(
            "No MCP server is logged in to in trace{}: nothing to list. \
             Connect one in Integrations → MCP servers.",
            only.map(|o| format!(" matching {o:?}")).unwrap_or_default()
        );
        return;
    }
    for server in servers {
        for url in endpoints(&server) {
            println!("\n=== {} at {url} ===", server.name);
            let caller = HttpCaller::new(server.clone()).with_endpoint(&url);
            match caller.tools().await {
                Ok(tools) => print_tools(&tools),
                Err(e) => println!("couldn't list its tools: {e}"),
            }
        }
    }
}

#[tokio::test]
#[ignore = "reaches mcp.context7.com"]
async fn mcp_live_open_server() {
    let caller = HttpCaller::new(Added {
        name: "context7".into(),
        url: "https://mcp.context7.com/mcp".into(),
        auth: Auth::Open,
        key: None,
        local: false,
        remote: false,
        logo: None,
    });
    let tools = caller.tools().await.expect("tools/list");
    print_tools(&tools);
    let resolve = tools
        .iter()
        .find(|t| t.name == "resolve-library-id")
        .expect("context7 offers resolve-library-id");
    let mut args = json!({ "libraryName": "serde" });
    // Fill any other required string argument the server has added since.
    let required = resolve.input_schema["required"].as_array().cloned();
    for name in required
        .unwrap_or_default()
        .iter()
        .filter_map(Value::as_str)
    {
        if args.get(name).is_none() {
            args[name] = json!("serde serialization for Rust");
        }
    }
    let found = caller
        .call("resolve-library-id", args)
        .await
        .expect("tools/call");
    let shown = found.to_string();
    let head: String = shown.chars().take(400).collect();
    println!("\nresolve-library-id → {head}");
    assert!(shown.to_lowercase().contains("serde"), "it found serde");
    let again = caller.tools().await.expect("a second call in the session");
    assert_eq!(again.len(), tools.len());
}
