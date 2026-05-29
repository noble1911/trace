//! Locate a coding-agent CLI binary (claude, codex, ...). Trimmed from the
//! previous project to just the discovery path — PTY mode never needs
//! `--help` capability probing.

use std::collections::HashMap;

fn find_in_path(path_value: &str, name: &str) -> Option<String> {
    for dir in std::env::split_paths(path_value) {
        let candidate = dir.join(name);
        if candidate.exists() && candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

/// Find a CLI binary by name, preferring the user's local install, then the
/// supplied/process `PATH`, then common system locations. `env_map` is the
/// effective CLI environment so we resolve the same binary the user would.
pub fn find_cli_with_env(name: &str, env_map: Option<&HashMap<String, String>>) -> Option<String> {
    let home = env_map
        .and_then(|map| map.get("HOME").cloned())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_default();

    // User-local installs: ~/.local/bin/<name>, plus the claude-style
    // ~/.<name>/local/<name> layout (harmless for binaries that don't use it).
    for path in [
        format!("{home}/.local/bin/{name}"),
        format!("{home}/.{name}/local/{name}"),
    ] {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }

    if let Some(found) = env_map
        .and_then(|map| map.get("PATH"))
        .and_then(|p| find_in_path(p, name))
    {
        return Some(found);
    }

    if let Ok(path_value) = std::env::var("PATH") {
        if let Some(found) = find_in_path(&path_value, name) {
            return Some(found);
        }
    }

    [
        format!("/usr/local/bin/{name}"),
        format!("/opt/homebrew/bin/{name}"),
    ]
    .into_iter()
    .find(|p| std::path::Path::new(p).exists())
}

/// Backwards-compatible alias kept so the PTY runner's older call sites still resolve.
pub fn find_claude_cli_with_env(env_map: Option<&HashMap<String, String>>) -> Option<String> {
    find_cli_with_env("claude", env_map)
}
