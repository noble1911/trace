//! Settings → Appearance's font pickers: a thin wrapper over `fonts`. The first
//! call scans the OS font folders, so it runs off the main thread.

use crate::fonts::InstalledFonts;

/// Every font family installed on this machine, proportional and monospace.
#[tauri::command]
pub async fn list_installed_fonts() -> Result<InstalledFonts, String> {
    tauri::async_runtime::spawn_blocking(crate::fonts::installed)
        .await
        .map_err(|e| e.to_string())
}
