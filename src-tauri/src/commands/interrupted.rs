//! Offering back agents interrupted by trace quitting, updating or crashing
//! (`crate::interrupted`).

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::commands::agent::spawn_in;
use crate::interrupted::{self, AgentLaunch};
use crate::state::{AppState, StartGuard};

/// A resumed agent's terminal size until its pane mounts and resizes it.
const COLS: u16 = 120;
const ROWS: u16 = 40;

/// The agents the previous run was cut off from.
#[tauri::command]
pub fn interrupted_agents(state: State<'_, AppState>) -> Vec<AgentLaunch> {
    interrupted::list(&state)
}

/// One resume attempt's outcome.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resumed {
    workspace_id: String,
    error: Option<String>,
}

/// Start the given interrupted agents again, each carrying on its saved
/// conversation — told to continue if it was mid-task. One failing (say, its
/// worktree was cleaned up) doesn't stop the rest.
#[tauri::command]
pub fn resume_interrupted_agents(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Vec<Resumed> {
    interrupted::take(&state, &ids)
        .into_iter()
        .map(|a| {
            let workspace_id = a.workspace_id.clone();
            let error = resume(&app, &state, a).err();
            Resumed { workspace_id, error }
        })
        .collect()
}

fn resume(app: &AppHandle, state: &AppState, a: AgentLaunch) -> Result<(), String> {
    if !std::path::Path::new(&a.cwd).is_dir() {
        return Err("its workspace no longer exists".to_string());
    }
    let Some(_guard) = StartGuard::acquire(state, &a.workspace_id) else {
        return Ok(()); // already being started
    };
    let ws = a.workspace_id.clone();
    let nudge = interrupted::resume_prompt(&a);
    spawn_in(
        app.clone(),
        state,
        a.workspace_id,
        a.cwd,
        a.cli,
        a.model,
        a.extra_args,
        None,
        nudge,
        a.provider,
        COLS,
        ROWS,
    )?;
    // The renderer learns it's running the way it does for scheduled runs.
    let _ = app.emit("agent-run-state", json!({ "workspaceId": ws, "running": true }));
    Ok(())
}

/// Forget the interrupted agents without resuming them.
#[tauri::command]
pub fn dismiss_interrupted_agents(state: State<'_, AppState>) {
    let ids: Vec<String> = interrupted::list(&state)
        .into_iter()
        .map(|a| a.workspace_id)
        .collect();
    interrupted::take(&state, &ids);
}
