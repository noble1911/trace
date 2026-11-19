//! Thin wrappers over `recap`: each agent's saved "where it's up to".

use std::collections::BTreeMap;

use crate::recap::{self, Recap};

/// Every saved recap, by workspace id.
#[tauri::command]
pub fn list_recaps() -> Result<BTreeMap<String, Recap>, String> {
    recap::list()
}

/// Save one workspace's recap; returns it as stored.
#[tauri::command]
pub fn save_recap(workspace_id: String, recap: Recap) -> Result<Recap, String> {
    recap::save(&workspace_id, recap)
}

/// The user opened this workspace; returns when they last had before (0 = never).
#[tauri::command]
pub fn mark_recap_seen(workspace_id: String, at: u64) -> Result<u64, String> {
    recap::mark_seen(&workspace_id, at)
}
