//! A [`ToolCaller`] for tests: canned results per tool name, and a record of
//! every call made. The MCP issue providers' tests run on it with payloads
//! recorded from the real servers (see `live`).
//!
//! ```ignore
//! let fake = FakeCaller::new()
//!     .with("get_me", json!({ "id": "u1" }))
//!     .with("search_issues", json!({ "issues": [], "cursor": "p2" }))
//!     .with("search_issues", json!({ "issues": [] })) // the second call's
//!     .failing("update_issue", "No such status");
//! let provider = PylonMcp::new(fake);
//! // … exercise the provider …
//! assert_eq!(provider.caller().calls_to("update_issue")[0]["status"], "closed");
//! ```

use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;

use serde_json::{json, Value};

use super::{ToolCaller, ToolInfo};

/// A tool by name only, with an empty object schema.
fn named(name: &str) -> ToolInfo {
    ToolInfo {
        name: name.to_string(),
        description: String::new(),
        input_schema: json!({ "type": "object" }),
    }
}

/// Canned results by tool name, and the calls made, in order.
#[derive(Default)]
pub(crate) struct FakeCaller {
    /// Per tool, its next results: each call takes the front one, and the
    /// last one answers every call after it.
    results: Mutex<BTreeMap<String, VecDeque<Result<Value, String>>>>,
    /// What `tools()` lists; None lists the canned tools' names.
    tools: Option<Vec<ToolInfo>>,
    calls: Mutex<Vec<(String, Value)>>,
}

impl FakeCaller {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    fn push(self, tool: &str, result: Result<Value, String>) -> Self {
        if let Ok(mut results) = self.results.lock() {
            results
                .entry(tool.to_string())
                .or_default()
                .push_back(result);
        }
        self
    }

    /// `tool` answers `value`. Given several times, the calls get them in turn.
    pub(crate) fn with(self, tool: &str, value: Value) -> Self {
        self.push(tool, Ok(value))
    }

    /// `tool` fails with `message`, as a server's error or an `isError` result would.
    pub(crate) fn failing(self, tool: &str, message: &str) -> Self {
        self.push(tool, Err(message.to_string()))
    }

    /// What `tools()` lists, by name (empty object schemas), in place of the
    /// canned tools' names: for testing what an adapter does when one's missing.
    pub(crate) fn listing(mut self, names: &[&str]) -> Self {
        self.tools = Some(names.iter().map(|n| named(n)).collect());
        self
    }

    /// What `tools()` lists, schemas and all: for an adapter that builds its
    /// arguments from the server's advertised input schemas.
    pub(crate) fn listing_tools(mut self, tools: Vec<ToolInfo>) -> Self {
        self.tools = Some(tools);
        self
    }

    /// Every call made, in order: the tool's name and its arguments.
    pub(crate) fn calls(&self) -> Vec<(String, Value)> {
        self.calls.lock().map(|c| c.clone()).unwrap_or_default()
    }

    /// The arguments of every call to `tool`, in order.
    pub(crate) fn calls_to(&self, tool: &str) -> Vec<Value> {
        let calls = self.calls().into_iter();
        calls.filter(|(t, _)| t == tool).map(|(_, a)| a).collect()
    }
}

impl ToolCaller for FakeCaller {
    async fn call(&self, tool: &str, args: Value) -> Result<Value, String> {
        if let Ok(mut calls) = self.calls.lock() {
            calls.push((tool.to_string(), args));
        }
        let mut results = self.results.lock().map_err(|e| e.to_string())?;
        let queue = results
            .get_mut(tool)
            .ok_or_else(|| format!("Unknown tool: {tool}"))?;
        match queue.len() {
            0 => Err(format!("Unknown tool: {tool}")),
            1 => queue[0].clone(),
            _ => queue.pop_front().unwrap_or_else(|| Ok(Value::Null)),
        }
    }

    async fn tools(&self) -> Result<Vec<ToolInfo>, String> {
        if let Some(tools) = &self.tools {
            return Ok(tools.clone());
        }
        let results = self.results.lock().map_err(|e| e.to_string())?;
        Ok(results.keys().map(|n| named(n)).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An adapter as the MCP issue providers will be: generic over the port.
    struct Board<T: ToolCaller> {
        caller: T,
    }

    impl<T: ToolCaller> Board<T> {
        async fn me(&self) -> Result<String, String> {
            let me = self.caller.call("get_me", json!({})).await?;
            Ok(me["name"].as_str().unwrap_or_default().to_string())
        }
    }

    fn is_send<F: std::future::Future + Send>(f: F) -> F {
        f
    }

    #[tokio::test]
    async fn an_adapter_generic_over_the_port_runs_on_the_fake() {
        let board = Board {
            caller: FakeCaller::new().with("get_me", json!({ "name": "Ron" })),
        };
        // As inside an `IssueProvider` method, whose futures must be Send.
        assert_eq!(is_send(board.me()).await, Ok("Ron".to_string()));
        assert_eq!(board.caller.calls(), vec![("get_me".into(), json!({}))]);
    }

    #[tokio::test]
    async fn results_come_in_turn_then_the_last_repeats() {
        let fake = FakeCaller::new()
            .with("page", json!(1))
            .with("page", json!(2))
            .failing("move", "No such status");
        assert_eq!(fake.call("page", json!({ "c": null })).await, Ok(json!(1)));
        assert_eq!(fake.call("page", json!({ "c": "p2" })).await, Ok(json!(2)));
        assert_eq!(fake.call("page", json!({})).await, Ok(json!(2)));
        assert_eq!(
            fake.call("move", json!({ "to": "x" })).await,
            Err("No such status".into())
        );
        assert_eq!(
            fake.call("nope", json!({})).await,
            Err("Unknown tool: nope".into())
        );
        assert_eq!(fake.calls_to("page")[1], json!({ "c": "p2" }));
        assert_eq!(fake.calls().len(), 5, "unknown tools are recorded too");
    }

    #[tokio::test]
    async fn tools_lists_the_canned_names_or_what_it_was_told() {
        let fake = FakeCaller::new().with("b", json!(0)).with("a", json!(0));
        let names: Vec<String> = fake
            .tools()
            .await
            .expect("tools")
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(names, ["a", "b"]);
        let told = FakeCaller::new().with("a", json!(0)).listing(&["x"]);
        assert_eq!(told.tools().await.expect("tools")[0].name, "x");
    }
}
