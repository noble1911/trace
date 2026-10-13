//! Workspace auto-cleanup settings, plus a preview and a manual pass for the
//! Settings → Worktrees panel. The logic lives in `cleanup/`.

use tauri::{AppHandle, State};

use crate::cleanup::settings::{self, CleanupSettings};
use crate::cleanup::sweep::{self, CleanupReport, Context};
use crate::state::AppState;

#[tauri::command]
pub fn get_cleanup_settings() -> CleanupSettings {
    settings::load()
}

/// Save the rules; returns them as stored (the idle period clamped).
#[tauri::command]
pub fn set_cleanup_settings(settings: CleanupSettings) -> Result<CleanupSettings, String> {
    let settings = settings.sanitized();
    settings::save(&settings)?;
    Ok(settings)
}

/// What the saved rules would delete right now — whether or not auto-cleanup is
/// on, so the user can see the effect before flipping it. Async + blocking pool:
/// it runs git in every worktree and may ask the tracker about each ticket.
#[tauri::command]
pub async fn preview_cleanup(state: State<'_, AppState>) -> Result<CleanupReport, String> {
    let ctx = Context::snapshot(&state);
    tauri::async_runtime::spawn_blocking(move || sweep::preview(&settings::load(), &ctx))
        .await
        .map_err(|e| format!("cleanup preview failed: {e}"))
}

/// Run one pass now with the saved rules (even with auto-cleanup off — the
/// button is an explicit request).
#[tauri::command]
pub async fn run_cleanup_now(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CleanupReport, String> {
    let ctx = Context::snapshot(&state);
    tauri::async_runtime::spawn_blocking(move || sweep::apply(&app, &settings::load(), &ctx))
        .await
        .map_err(|e| format!("cleanup failed: {e}"))
}
