//! Locate the `claude` CLI binary. Trimmed from the previous project to just
//! the discovery path — PTY mode never needs `--help` capability probing.

use std::collections::HashMap;

fn find_in_path(path_value: &str) -> Option<String> {
    for dir in std::env::split_paths(path_value) {
        let candidate = dir.join("claude");
        if candidate.exists() && candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

/// Find the `claude` binary, preferring the user's local install, then the
/// supplied/process `PATH`, then common system locations. `env_map` is the
/// effective CLI environment so we resolve the same `claude` the user would.
pub fn find_claude_cli_with_env(env_map: Option<&HashMap<String, String>>) -> Option<String> {
    let home = env_map
        .and_then(|map| map.get("HOME").cloned())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_default();

    for path in [
        format!("{home}/.local/bin/claude"),
        format!("{home}/.claude/local/claude"),
    ] {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }

    if let Some(found) = env_map
        .and_then(|map| map.get("PATH"))
        .and_then(|p| find_in_path(p))
    {
        return Some(found);
    }

    if let Ok(path_value) = std::env::var("PATH") {
        if let Some(found) = find_in_path(&path_value) {
            return Some(found);
        }
    }

    ["/usr/local/bin/claude", "/opt/homebrew/bin/claude"]
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .map(|p| p.to_string())
}
