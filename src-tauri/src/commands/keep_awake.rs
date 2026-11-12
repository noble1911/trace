//! The Settings switch for keeping the computer awake while agents run. The logic
//! lives in `keep_awake`.

use crate::keep_awake;

/// Whether the computer is kept awake while agents run.
#[tauri::command]
pub fn get_keep_awake() -> bool {
    keep_awake::enabled()
}

/// Turn it on or off; takes effect at once.
#[tauri::command]
pub fn set_keep_awake(enabled: bool) -> Result<(), String> {
    keep_awake::set_enabled(enabled)
}
