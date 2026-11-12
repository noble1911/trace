//! trace's own MCP client: the backend calling tools on a remote MCP server
//! (the trackers' boards over Jira's and Pylon's MCP servers), as opposed to
//! `mcp_auth::proxy`, which only passes agents' traffic through.
//!
//! A port and one adapter. Callers (the MCP issue providers) depend on
//! [`ToolCaller`], "call tool X with this JSON", and never on HTTP; `http` is
//! the only place that knows MCP's wire format (Streamable HTTP, JSON-RPC,
//! SSE), with its pure parts in `wire` and `sse` so they're tested without a
//! network.
//!
//! **Why async, and why not `dyn`.** Its callers are `issues::IssueProvider`
//! impls, whose methods return `impl Future + Send`; a blocking caller would
//! make every one of them hop to `spawn_blocking` and clone itself in. So the
//! trait is async in the same shape as `IssueProvider` (return-position
//! `impl Future + Send`). That shape isn't object-safe, which is fine: an
//! adapter is generic over `T: ToolCaller` (`HttpCaller` in the app,
//! `fake::FakeCaller` in tests), or holds an enum of callers, like
//! `issues::Provider`. `ToolCaller: Send + Sync` so `&self` can be held across
//! an `.await` inside an `IssueProvider` future.

pub mod args;
pub mod http;
mod sse;
mod transport;
mod wire;

#[cfg(test)]
pub(crate) mod fake;
#[cfg(test)]
mod live;

use std::future::Future;

use serde::Serialize;
use serde_json::Value;

/// A tool a server offers, as `tools/list` describes it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    /// Its arguments' JSON Schema, as the server sent it (`{}` when it sent none).
    pub input_schema: Value,
}

/// Something that calls tools on an MCP server. The port the MCP issue
/// providers depend on: they say which tool with which arguments and get its
/// result as JSON, and never see the transport.
pub trait ToolCaller: Send + Sync {
    /// Call `tool` with `args` (a JSON object). Ok is the tool's result as
    /// JSON: its `structuredContent` when it gave one, else its text content
    /// (parsed when it's JSON). Err is the server's message, for a protocol
    /// error and for a tool that reported it failed (`isError`) alike.
    fn call(&self, tool: &str, args: Value) -> impl Future<Output = Result<Value, String>> + Send;

    /// Every tool the server offers (all pages). For checking on connect that
    /// the tools an adapter needs are there, and for learning their arguments.
    fn tools(&self) -> impl Future<Output = Result<Vec<ToolInfo>, String>> + Send;
}
