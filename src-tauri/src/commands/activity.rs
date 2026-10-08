//! Activity-log commands: read the feed, record a renderer-side action, clear,
//! and the one-time import of the old localStorage feed.

use tauri::AppHandle;

use crate::activity::{self, ActivityEvent, ActivityInput};

/// Newest-first events (default: all kept).
#[tauri::command]
pub fn list_activity(limit: Option<usize>) -> Vec<ActivityEvent> {
    activity::list(limit.unwrap_or(usize::MAX))
}

/// Record an action the renderer took (a card move, an agent start, a PR). The
/// stored event comes back, and is also broadcast as `activity-event`.
#[tauri::command]
pub fn record_activity(app: AppHandle, input: ActivityInput) -> Result<ActivityEvent, String> {
    if input.title.trim().is_empty() {
        return Err("An activity event needs a title.".into());
    }
    Ok(activity::record(&app, input))
}

#[tauri::command]
pub fn clear_activity() -> Result<(), String> {
    activity::clear().map_err(|e| format!("Couldn't clear activity: {e}"))
}

/// Seed an empty log with the pre-backend feed; `false` if it already had events.
#[tauri::command]
pub fn import_activity(events: Vec<ActivityEvent>) -> Result<bool, String> {
    activity::import(events).map_err(|e| format!("Couldn't import activity: {e}"))
}
