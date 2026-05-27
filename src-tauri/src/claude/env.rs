//! Build the environment the `claude` CLI runs under. Trimmed to the essentials
//! needed by the PTY transport: capture the user's login-shell env, augment
//! PATH, and apply per-agent overrides.

use std::collections::HashMap;
use std::process::Command;

/// Env var prefixes that override the CLI's built-in model resolution. Stripping
/// them lets `--model opus` resolve to the latest model the CLI knows, instead
/// of stale values baked into a shell profile.
pub const MODEL_OVERRIDE_ENV_PREFIXES: &[&str] = &["CLAUDE_MODEL_", "CLAUDE_BEDROCK_MODEL_"];

/// Capture the user's login-shell environment so the agent sees the same PATH,
/// API keys, and tooling the user would in a terminal. Falls back to the
/// process env if the shell probe yields nothing.
pub fn load_cli_shell_env() -> HashMap<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(&shell)
        .args(["-lic", "printenv"])
        .env("DISABLE_AUTO_UPDATE", "true")
        .env("ZSH_DISABLE_COMPFIX", "true")
        .output();

    match output {
        Ok(ref out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut map = HashMap::new();
            for line in stdout.lines() {
                if let Some((key, value)) = line.split_once('=') {
                    if !key.trim().is_empty() {
                        map.insert(key.to_string(), value.to_string());
                    }
                }
            }
            if map.is_empty() {
                std::env::vars().collect()
            } else {
                map
            }
        }
        Err(_) => std::env::vars().collect(),
    }
}

/// Compose the effective CLI env: login-shell env + an augmented PATH (so common
/// install locations resolve) + caller overrides.
pub fn build_effective_cli_env(env_overrides: &HashMap<String, String>) -> HashMap<String, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut env_map = load_cli_shell_env();

    let existing = env_map
        .get("PATH")
        .cloned()
        .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());
    let extra = format!("{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    let merged = if existing.is_empty() {
        extra
    } else {
        format!("{extra}:{existing}")
    };
    env_map.insert("PATH".to_string(), merged);

    for (key, value) in env_overrides {
        if !key.trim().is_empty() {
            env_map.insert(key.clone(), value.clone());
        }
    }

    env_map
}
