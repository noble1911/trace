//! The renderer's side of the agent tool server (`agent_tools`): registering
//! the tools it runs, and answering the calls it's handed.

use serde_json::Value;
use tauri::AppHandle;

/// Register (replace) the tool definitions trace offers its agents.
#[tauri::command]
pub fn set_agent_tools(app: AppHandle, tools: Vec<Value>) {
    crate::agent_tools::set_defs(&app, tools);
}

/// Answer an `agent-tool-call` event.
#[tauri::command]
pub fn agent_tool_result(app: AppHandle, id: String, text: String, is_error: bool) {
    crate::agent_tools::resolve(&app, &id, text, is_error);
}
