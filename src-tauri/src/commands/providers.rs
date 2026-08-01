//! Model providers for the Claude Code harness.
//!
//! Claude Code honours `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`, so any
//! Anthropic-compatible endpoint (Moonshot's Kimi, Wafer Serverless, DeepSeek,
//! ...) can back the *same* `claude` CLI — the PTY transport, session resume,
//! and worktree lifecycle are untouched. The provider is a launch-time choice;
//! the env is injected in `spawn_in` (`commands::agent`) as overrides, which
//! win over the login shell.
//!
//! Wafer (and DeepSeek) expose variant model ids that share one API key file
//! (Wafer normal/fast, DeepSeek flash/pro).
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
    /// Key file name under the trace config dir. Shared across normal/fast
    /// variants of the same endpoint (e.g. both Wafer ids use `wafer-key`).
    key_file: &'static str,
    /// When set, haiku alias + subagent use this instead of the primary model
    /// (DeepSeek's recommended split: pro for opus/sonnet, flash for haiku).
    haiku_model: Option<&'static str>,
    /// Optional `CLAUDE_CODE_EFFORT_LEVEL` (DeepSeek recommends `"max"`).
    effort_level: Option<&'static str>,
}

/// Moonshot's own Anthropic-compatible endpoint (Kimi direct).
const MOONSHOT: ProviderSpec = ProviderSpec {
    id: "moonshot",
    base_url: "https://api.moonshot.ai/anthropic",
    default_model: "kimi-k3",
    model_prefix: "kimi",
    key_file: "moonshot-key",
    haiku_model: None,
    effort_level: None,
};

/// Wafer Serverless Anthropic-compatible endpoint (docs.wafer.ai/serverless).
/// Claude Code hits `{base}/v1/messages`; model ids are case-insensitive.
const WAFER: ProviderSpec = ProviderSpec {
    id: "wafer",
    base_url: "https://pass.wafer.ai",
    default_model: "Kimi-K3",
    // Matches Kimi-K3 / kimi-k3-fast / Kimi-K2.6 (prefix check is case-insensitive).
    model_prefix: "kimi",
    key_file: "wafer-key",
    haiku_model: None,
    effort_level: None,
};

/// Wafer's high-TPS Kimi K3 tier.
const WAFER_FAST: ProviderSpec = ProviderSpec {
    id: "wafer-fast",
    base_url: "https://pass.wafer.ai",
    default_model: "kimi-k3-fast",
    model_prefix: "kimi",
    key_file: "wafer-key",
    haiku_model: None,
    effort_level: None,
};

/// DeepSeek Anthropic-compatible endpoint
/// (api-docs.deepseek.com/quick_start/agent_integrations/claude_code).
/// Default is V4-Flash-0731 — DeepSeek's own agent/coding benches put it ahead
/// of V4-Pro Preview (e.g. Terminal Bench 2.1 82.7 vs 72.1), cheaper/faster.
/// Effort max matches their Claude Code setup.
const DEEPSEEK: ProviderSpec = ProviderSpec {
    id: "deepseek",
    base_url: "https://api.deepseek.com/anthropic",
    default_model: "deepseek-v4-flash",
    model_prefix: "deepseek",
    key_file: "deepseek-key",
    haiku_model: None,
    effort_level: Some("max"),
};

/// DeepSeek Pro for hard math / long-context reasoning where Flash isn't enough.
const DEEPSEEK_PRO: ProviderSpec = ProviderSpec {
    id: "deepseek-pro",
    base_url: "https://api.deepseek.com/anthropic",
    default_model: "deepseek-v4-pro[1m]",
    model_prefix: "deepseek",
    key_file: "deepseek-key",
    // Keep light turns on Flash even when the primary is Pro.
    haiku_model: Some("deepseek-v4-flash"),
    effort_level: Some("max"),
};

/// Look up a provider spec by its frontend id. `None` = Anthropic (no env).
pub(crate) fn spec(id: &str) -> Option<&'static ProviderSpec> {
    match id {
        "moonshot" => Some(&MOONSHOT),
        "wafer" => Some(&WAFER),
        "wafer-fast" => Some(&WAFER_FAST),
        "deepseek" => Some(&DEEPSEEK),
        "deepseek-pro" => Some(&DEEPSEEK_PRO),
        _ => None,
    }
}

/// Whether this provider is any Wafer variant (shared key + ZDR header).
pub(crate) fn is_wafer(spec: &ProviderSpec) -> bool {
    spec.key_file == "wafer-key"
}

/// Whether this provider is any DeepSeek variant (shared key).
fn is_deepseek(spec: &ProviderSpec) -> bool {
    spec.key_file == "deepseek-key"
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

/// Env overrides that point the Claude Code harness at `spec`'s endpoint and
/// pin Claude Code's built-in model aliases (opus/sonnet/haiku/subagent) to
/// provider models — without these, the CLI still sends Anthropic model ids
/// that the third-party endpoint rejects.
/// Errors when no key is configured so the user gets a clear message instead
/// of a TUI that fails auth on first contact.
pub(crate) fn env(
    spec: &ProviderSpec,
    model: &str,
) -> Result<HashMap<String, String>, String> {
    let key = key(spec).ok_or_else(|| {
        let host = if is_wafer(spec) {
            "wafer"
        } else if is_deepseek(spec) {
            "deepseek"
        } else {
            spec.id
        };
        format!("Add your {host} API key in Settings → General first.")
    })?;
    let mut env = HashMap::new();
    env.insert("ANTHROPIC_BASE_URL".to_string(), spec.base_url.to_string());
    env.insert("ANTHROPIC_AUTH_TOKEN".to_string(), key);
    // Claude Code maps its opus/sonnet/haiku aliases (and subagent launches)
    // through these envs. Pin every alias so a Settings default like "sonnet"
    // or an internal subagent spawn can't leak an Anthropic id.
    env.insert("ANTHROPIC_MODEL".to_string(), model.to_string());
    env.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), model.to_string());
    env.insert("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), model.to_string());
    let light = spec.haiku_model.unwrap_or(model);
    env.insert("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), light.to_string());
    env.insert("CLAUDE_CODE_SUBAGENT_MODEL".to_string(), light.to_string());
    if let Some(effort) = spec.effort_level {
        env.insert("CLAUDE_CODE_EFFORT_LEVEL".to_string(), effort.to_string());
    }
    // Wafer request-scoped ZDR (docs.wafer.ai/serverless/zero-data-retention).
    if is_wafer(spec) {
        env.insert(
            "ANTHROPIC_CUSTOM_HEADERS".to_string(),
            "Wafer-ZDR: required".to_string(),
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
pub fn wafer_key_configured() -> bool {
    key_configured(&WAFER)
}

#[tauri::command]
pub fn set_wafer_key(key: String) -> Result<(), String> {
    set_key(&WAFER, key)
}

#[tauri::command]
pub fn deepseek_key_configured() -> bool {
    key_configured(&DEEPSEEK)
}

#[tauri::command]
pub fn set_deepseek_key(key: String) -> Result<(), String> {
    set_key(&DEEPSEEK, key)
}
