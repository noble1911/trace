//! Jira credential handling: validate a connection and persist it so the app
//! reconnects on launch.
//!
//! Storage is a `0600` file in the app's config dir rather than the OS keychain.
//! On macOS the keychain ACL is bound to the exact binary, so every unsigned
//! `tauri dev` rebuild re-prompts ("Always Allow" only whitelists that one
//! build) — unusable in development. A user-only file (the same approach as
//! `gh`, `npm`, `aws`) reconnects silently. The token is never logged.
//! When release builds are code-signed we can move back to the keychain.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::client;
use super::models::{parse_user, JiraUser};
use super::JiraConnection;

#[derive(Serialize, Deserialize)]
struct StoredSession {
    site: String,
    email: String,
    token: String,
}

/// Validate a connection by calling `/myself`. Returns the authenticated user.
pub async fn validate(conn: &JiraConnection) -> Result<JiraUser, String> {
    let v = client::get(conn, "/rest/api/3/myself").await?;
    Ok(parse_user(&v))
}

/// Persist the session (site + email + token) for silent reconnect on launch.
pub fn save(conn: &JiraConnection) -> Result<(), String> {
    let path = session_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(&StoredSession {
        site: conn.site.clone(),
        email: conn.email.clone(),
        token: conn.token.clone(),
    })
    .map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    restrict_perms(&path);
    Ok(())
}

/// Load the previously-saved connection, if any.
pub fn load() -> Option<JiraConnection> {
    let raw = std::fs::read_to_string(session_path()).ok()?;
    let s: StoredSession = serde_json::from_str(&raw).ok()?;
    Some(JiraConnection {
        site: s.site,
        email: s.email,
        token: s.token,
    })
}

/// Forget the saved connection.
pub fn clear() -> Result<(), String> {
    let _ = std::fs::remove_file(session_path());
    Ok(())
}

fn session_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("jira-session.json")
}

#[cfg(unix)]
fn restrict_perms(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_perms(_path: &Path) {}
