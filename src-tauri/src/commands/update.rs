//! App self-update commands. The updater plugin polls the `latest.json`
//! asset on the repo's latest GitHub release (endpoint + minisign pubkey in
//! `tauri.conf.json`); these wrappers expose check/install to the frontend.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// What the frontend needs to offer an update: versions + release notes.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Check the release feed for a newer build. `Ok(None)` means up to date.
#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| format!("Updater unavailable: {e}"))?;
    let update = updater.check().await.map_err(|e| format!("Update check failed: {e}"))?;
    Ok(update.map(|u| UpdateInfo {
        current_version: u.current_version.clone(),
        version: u.version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

/// Download and install the available update, then restart into the new
/// build. Re-checks rather than trusting the frontend's earlier result — the
/// signature is verified against the bundled pubkey during install.
#[tauri::command]
pub async fn install_app_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| format!("Updater unavailable: {e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?
        .ok_or_else(|| "No update available.".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Update install failed: {e}"))?;
    app.request_restart();
    Ok(())
}
