//! Persist the agent rich-output (HTML cards) panel across restarts. Small JSON
//! in the config dir (no DB), keyed by workspace id, written 0600 like the rest
//! of our persistence. The frontend store is the source of truth; these commands
//! just load it on launch and save it on change.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::helpers::{restrict_perms, trace_dir};

/// One rendered card. Mirrors the frontend `HtmlBlock`; `html` is raw (the panel
/// renders it in a sandboxed iframe, so nothing here is trusted markup).
#[derive(Serialize, Deserialize)]
pub struct RichBlock {
    pub id: u64,
    pub html: String,
}

fn rich_output_file() -> PathBuf {
    trace_dir().join("rich-output.json")
}

/// Load the saved cards (workspace id → cards). Missing/corrupt file → empty map,
/// so a first run or a hand-deleted file is never an error.
#[tauri::command]
pub fn load_rich_output() -> Result<HashMap<String, Vec<RichBlock>>, String> {
    match std::fs::read_to_string(rich_output_file()) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(_) => Ok(HashMap::new()),
    }
}

/// Overwrite the saved cards with the store's current state.
#[tauri::command]
pub fn save_rich_output(blocks: HashMap<String, Vec<RichBlock>>) -> Result<(), String> {
    let path = rich_output_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(&blocks).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    restrict_perms(&path);
    Ok(())
}
