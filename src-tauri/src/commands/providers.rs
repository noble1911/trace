//! Model providers for the Claude Code harness.
//!
//! Claude Code honours `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`, so any
//! Anthropic-compatible endpoint (Moonshot's Kimi, Fireworks' Kimi K3 Fast, ...)
//! can back the *same* `claude` CLI — the PTY transport, session resume, and
//! worktree lifecycle are untouched. The provider is a launch-time choice; the
//! env is injected in `spawn_in` (`commands::agent`) as overrides, which win
//! over the login shell.
//!
//! Each provider's API key is stored in a `0600` file in the config dir (same
//! pattern as the Jira session) and never crosses to the renderer — the
//! frontend only learns whether one is configured.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::helpers::restrict_perms;

/// A third-party Anthropic-compatible endpoint that can back the `claude` CLI.
pub(crate) struct ProviderSpec {
    /// The value the frontend passes as `provider` (e.g. "moonshot").
    pub id: &'static str,
    /// Base URL for `ANTHROPIC_BASE_URL` (the endpoint appends `/v1/messages`).
    pub base_url: &'static str,
    /// Model used when the configured default doesn't belong to this provider.
    pub default_model: &'static str,
    /// Prefix that marks a `--model` value as valid for this provider — a
    /// Settings default aimed at Anthropic (e.g. "fable") must not leak through.
    pub model_prefix: &'static str,
    /// Key file name under the trace config dir.
    key_file: &'static str,
}

/// Moonshot's own Anthropic-compatible endpoint (Kimi direct).
const MOONSHOT: ProviderSpec = ProviderSpec {
    id: "moonshot",
    base_url: "https://api.moonshot.ai/anthropic",
    default_model: "kimi-k3",
    model_prefix: "kimi",
    key_file: "moonshot-key",
};

/// Fireworks' Anthropic-compatible endpoint — Kimi K3 on the Fast serving tier.
const FIREWORKS: ProviderSpec = ProviderSpec {
    id: "fireworks",
    base_url: "https://api.fireworks.ai/inference",
    default_model: "accounts/fireworks/routers/kimi-k3-fast",
    model_prefix: "accounts/fireworks/",
    key_file: "fireworks-key",
};

/// Look up a provider spec by its frontend id. `None` = Anthropic (no env).
pub(crate) fn spec(id: &str) -> Option<&'static ProviderSpec> {
    match id {
        "moonshot" => Some(&MOONSHOT),
        "fireworks" => Some(&FIREWORKS),
        _ => None,
    }
}

fn key_path(spec: &ProviderSpec) -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join(spec.key_file)
}

/// The saved API key for a provider, or `None` if unset. Rust-side only.
fn key(spec: &ProviderSpec) -> Option<String> {
    std::fs::read_to_string(key_path(spec))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Env overrides that point the Claude Code harness at `spec`'s endpoint.
/// Errors when no key is configured so the user gets a clear message instead
/// of a TUI that fails auth on first contact.
pub(crate) fn env(spec: &ProviderSpec) -> Result<HashMap<String, String>, String> {
    let key = key(spec).ok_or_else(|| {
        format!("Add your {} API key in Settings → General first.", spec.id)
    })?;
    let mut env = HashMap::new();
    env.insert("ANTHROPIC_BASE_URL".to_string(), spec.base_url.to_string());
    env.insert("ANTHROPIC_AUTH_TOKEN".to_string(), key.clone());
    // Fireworks also honours its own header, which wins over a stray
    // ANTHROPIC_API_KEY from the user's shell profile (BYOK forwarding).
    if spec.id == "fireworks" {
        env.insert(
            "ANTHROPIC_CUSTOM_HEADERS".to_string(),
            format!("X-Fireworks-Api-Key: {key}"),
        );
    }
    Ok(env)
}

/// Whether a provider's API key is saved (the key itself never leaves Rust).
fn key_configured(spec: &ProviderSpec) -> bool {
    key(spec).is_some()
}

/// Persist (or, with an empty string, clear) a provider's API key.
fn set_key(spec: &ProviderSpec, key: String) -> Result<(), String> {
    let path = key_path(spec);
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

#[tauri::command]
pub fn moonshot_key_configured() -> bool {
    key_configured(&MOONSHOT)
}

#[tauri::command]
pub fn set_moonshot_key(key: String) -> Result<(), String> {
    set_key(&MOONSHOT, key)
}

#[tauri::command]
pub fn fireworks_key_configured() -> bool {
    key_configured(&FIREWORKS)
}

#[tauri::command]
pub fn set_fireworks_key(key: String) -> Result<(), String> {
    set_key(&FIREWORKS, key)
}
