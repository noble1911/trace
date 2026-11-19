//! The Pull requests page's PRs raised in trace (`github::raised`), for the
//! sessions the page names and every ticket trace has started.
//!
//! Tickets come from the backend's own record (each start pins its repo), not
//! from which agents are live: a ticket's PR outlives its agent, and the page
//! would otherwise lose it on the agent's exit.

use crate::github::raised::{collect, sources, RaisedPr};

/// Every PR the workspaces `ids` and every started ticket raised, with states.
/// Shells out to `git`/`gh`, so it runs off the main thread.
#[tauri::command]
pub async fn raised_prs(ids: Vec<String>) -> Result<Vec<RaisedPr>, String> {
    tauri::async_runtime::spawn_blocking(move || collect(&sources::workspaces(ids)))
        .await
        .map_err(|e| e.to_string())
}
