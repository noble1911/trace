//! Jira credential handling: validate a connection and persist it in the OS
//! keychain. The API token never leaves the Rust process / keychain.

use std::path::PathBuf;

use keyring::Entry;
use serde::{Deserialize, Serialize};

use super::client;
use super::models::{parse_user, JiraUser};
use super::JiraConnection;

const KEYRING_SERVICE: &str = "com.obsidianos.trace.jira";

#[derive(Serialize, Deserialize)]
struct StoredCreds {
    email: String,
    token: String,
}

/// Validate a connection by calling `/myself`. Returns the authenticated user.
pub async fn validate(conn: &JiraConnection) -> Result<JiraUser, String> {
    let v = client::get(conn, "/rest/api/3/myself").await?;
    Ok(parse_user(&v))
}

/// Store the token (secret) in the keychain keyed by site, and remember the
/// active site in a small non-secret pointer file so we can reconnect on launch.
pub fn save(conn: &JiraConnection) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, &conn.site).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&StoredCreds {
        email: conn.email.clone(),
        token: conn.token.clone(),
    })
    .map_err(|e| e.to_string())?;
    entry.set_password(&json).map_err(|e| e.to_string())?;
    write_active_site(&conn.site)
}

/// Load the previously-connected connection from the keychain, if any.
pub fn load() -> Option<JiraConnection> {
    let site = read_active_site()?;
    let entry = Entry::new(KEYRING_SERVICE, &site).ok()?;
    let json = entry.get_password().ok()?;
    let creds: StoredCreds = serde_json::from_str(&json).ok()?;
    Some(JiraConnection {
        site,
        email: creds.email,
        token: creds.token,
    })
}

/// Forget the active connection (keychain entry + pointer file).
pub fn clear() -> Result<(), String> {
    if let Some(site) = read_active_site() {
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, &site) {
            let _ = entry.delete_credential();
        }
    }
    let _ = std::fs::remove_file(pointer_path());
    Ok(())
}

fn pointer_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("trace").join("jira-site")
}

fn write_active_site(site: &str) -> Result<(), String> {
    let path = pointer_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, site).map_err(|e| e.to_string())
}

fn read_active_site() -> Option<String> {
    std::fs::read_to_string(pointer_path())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
