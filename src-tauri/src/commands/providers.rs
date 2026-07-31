//! Model providers for the Claude Code harness.
//!
//! Claude Code honours `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`, so any
//! Anthropic-compatible endpoint (Moonshot's Kimi, ...) can back the *same*
//! `claude` CLI — the PTY transport, session resume, and worktree lifecycle are
//! untouched. The provider is a launch-time choice; the env is injected in
//! `spawn_in` (`commands::agent`) as overrides, which win over the login shell.
//!
//! The Moonshot API key is stored in a `0600` file in the config dir (same
//! pattern as the Jira session) and never crosses to the renderer — the
//! frontend only learns whether one is configured.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::helpers::restrict_perms;

/// Moonshot's Anthropic-compatible endpoint.
pub(crate) const MOONSHOT_BASE_URL: &str = "https://api.moonshot.ai/anthropic";

/// Model used when the provider is Moonshot and no --model default is set —
/// Moonshot serves Kimi models, so Claude's built-in default wouldn't resolve.
pub(crate) const MOONSHOT_DEFAULT_MODEL: &str = "kimi-k3";

fn key_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("moonshot-key")
}

/// The saved Moonshot API key, or `None` if unset. Rust-side only.
pub(crate) fn moonshot_key() -> Option<String> {
    std::fs::read_to_string(key_file())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Env overrides that point the Claude Code harness at Moonshot. Errors when no
/// key is configured so the user gets a clear message instead of a TUI that
/// fails auth on first contact.
pub(crate) fn moonshot_env() -> Result<HashMap<String, String>, String> {
    let key = moonshot_key()
        .ok_or_else(|| "Add your Moonshot API key in Settings → General first.".to_string())?;
    let mut env = HashMap::new();
    env.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        MOONSHOT_BASE_URL.to_string(),
    );
    env.insert("ANTHROPIC_AUTH_TOKEN".to_string(), key);
    Ok(env)
}

/// Whether a Moonshot API key is saved (the key itself never leaves Rust).
#[tauri::command]
pub fn moonshot_key_configured() -> bool {
    moonshot_key().is_some()
}

/// Persist (or, with an empty string, clear) the Moonshot API key.
#[tauri::command]
pub fn set_moonshot_key(key: String) -> Result<(), String> {
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
