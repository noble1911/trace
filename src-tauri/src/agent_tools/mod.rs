//! Tools trace serves to its own agents over MCP, so a Claude session can act on
//! trace: read the board, move tickets, start agents, read and fix scheduled
//! prompts.
//!
//! The actions already exist in the renderer (the board orchestrator's tools run
//! through the same store the UI uses), so they aren't reimplemented here. The
//! renderer registers its tool definitions (`set_defs`); this side serves them
//! over a loopback MCP endpoint (`server`), and a `tools/call` is handed to the
//! renderer as an `agent-tool-call` event and answered through `resolve`.
//!
//! - `rpc`: the JSON-RPC surface, pure.
//! - `server`: the loopback HTTP listener and its auth.
//!
//! Every agent is given the endpoint by `spawn_in` (`mcp_config_arg`), with the
//! per-app token in a header — the same trust model as the render bridge.

pub mod rpc;
pub mod server;

use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::helpers::new_id;
use crate::state::AppState;
use rpc::ToolReply;

/// Long enough for `start_agent` to create a worktree; a stuck call still
/// returns an error to the agent rather than hanging its turn.
const CALL_TIMEOUT: Duration = Duration::from_secs(180);

/// The registered tool definitions and the calls waiting on the renderer.
#[derive(Default)]
pub struct AgentTools {
    defs: Mutex<Vec<Value>>,
    pending: Mutex<HashMap<String, mpsc::Sender<ToolReply>>>,
}

/// Where agents reach the server. `port == 0` = it failed to bind (agents just
/// don't get the tools).
#[derive(Clone, Default)]
pub struct ToolServer {
    pub port: u16,
    pub token: String,
}

/// `agent-tool-call` event payload.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolCall<'a> {
    id: &'a str,
    name: &'a str,
    arguments: &'a Value,
    /// The workspace id of the agent calling (its issue key, session id, …).
    caller: &'a str,
}

/// Replace the tool definitions the renderer offers (MCP `Tool` objects).
pub fn set_defs(app: &AppHandle, defs: Vec<Value>) {
    *app.state::<AppState>().agent_tools.defs.lock() = defs;
}

pub fn defs(app: &AppHandle) -> Vec<Value> {
    app.state::<AppState>().agent_tools.defs.lock().clone()
}

/// The renderer's answer to a call.
pub fn resolve(app: &AppHandle, id: &str, text: String, is_error: bool) {
    let tx = app.state::<AppState>().agent_tools.pending.lock().remove(id);
    if let Some(tx) = tx {
        let _ = tx.send(ToolReply { text, is_error });
    }
}

/// Hand a call to the renderer and wait for its answer.
pub fn call(app: &AppHandle, name: &str, arguments: &Value, caller: &str) -> ToolReply {
    let id = new_id();
    let (tx, rx) = mpsc::channel();
    let state = app.state::<AppState>();
    let tools = &state.agent_tools;
    tools.pending.lock().insert(id.clone(), tx);
    let event = ToolCall { id: &id, name, arguments, caller };
    let reply = match app.emit("agent-tool-call", event) {
        Ok(()) => rx.recv_timeout(CALL_TIMEOUT).unwrap_or_else(|_| ToolReply {
            text: format!("trace didn't answer {name} in time. Is its window open?"),
            is_error: true,
        }),
        Err(e) => ToolReply { text: format!("Couldn't reach trace's window: {e}"), is_error: true },
    };
    tools.pending.lock().remove(&id);
    reply
}

/// The `--mcp-config` JSON for one agent: the endpoint, the token, and who it is.
pub fn mcp_config_arg(server: &ToolServer, workspace_id: &str) -> String {
    json!({
        "mcpServers": {
            "trace": {
                "type": "http",
                "url": format!("http://127.0.0.1:{}/mcp", server.port),
                "headers": {
                    "Authorization": format!("Bearer {}", server.token),
                    "X-Trace-Workspace": workspace_id,
                },
            }
        }
    })
    .to_string()
}

/// The permission rule that lets agents call these tools without a prompt.
pub const ALLOW_RULE: &str = "mcp__trace";
