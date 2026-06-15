//! Orchestrator config: the Anthropic API key for the in-app assistant.
//!
//! Stored in a `0600` file in the config dir (same pattern as the Jira
//! session). The key *does* cross to the renderer — the orchestrator's
//! Anthropic SDK runs in the frontend (the chosen architecture) — but
//! persisting it `0600` keeps it out of the webview's localStorage and
//! consistent with how the Jira credential is handled.

use std::path::PathBuf;

use crate::helpers::restrict_perms;

fn key_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("anthropic-key")
}

/// The saved Anthropic API key, or `None` if unset.
#[tauri::command]
pub fn get_anthropic_key() -> Option<String> {
    std::fs::read_to_string(key_file())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Persist (or, with an empty string, clear) the Anthropic API key.
#[tauri::command]
pub fn set_anthropic_key(key: String) -> Result<(), String> {
    let path = key_file();
    let key = key.trim();
    if key.is_empty() {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, key).map_err(|e| e.to_string())?;
    restrict_perms(&path);
    Ok(())
}
