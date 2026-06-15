//! Orchestrator config: the Anthropic API key for the in-app assistant.
//!
//! Stored in a `0600` file in the config dir (same pattern as the Jira
//! session). The key *does* cross to the renderer — the orchestrator's
//! Anthropic SDK runs in the frontend (the chosen architecture) — but
//! persisting it `0600` keeps it out of the webview's localStorage and
//! consistent with how the Jira credential is handled.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use crate::claude::discovery::find_cli_with_env;
use crate::claude::env::{build_effective_cli_env, MODEL_OVERRIDE_ENV_PREFIXES};
use crate::helpers::restrict_perms;

fn key_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("anthropic-key")
}

/// The saved Anthropic API key, or `None` if unset.
#[tauri::command]
pub fn get_anthropic_key() -> Option<String> {
    std::fs::read_to_string(key_file())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Persist (or, with an empty string, clear) the Anthropic API key.
#[tauri::command]
pub fn set_anthropic_key(key: String) -> Result<(), String> {
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

/// Run the orchestrator through the Claude CLI in print mode (`-p`) — an
/// alternative to the in-renderer SDK that uses the user's logged-in Claude CLI
/// auth (no API key, no browser CORS). One-shot and read-only: it answers from
/// the board snapshot in the prompt; the tool/action loop stays on the SDK path.
/// Resolves the binary + env exactly like the PTY agents do.
#[tauri::command]
pub async fn orchestrator_cli(
    system: String,
    prompt: String,
    model: Option<String>,
) -> Result<String, String> {
    let env_map = build_effective_cli_env(&HashMap::new());
    let claude = find_cli_with_env("claude", Some(&env_map))
        .ok_or_else(|| "Could not find the `claude` CLI on PATH.".to_string())?;

    let mut cmd = tokio::process::Command::new(&claude);
    // A neutral cwd (home) so it doesn't absorb a project's CLAUDE.md / context.
    cmd.current_dir(dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")));
    cmd.arg("--print");
    // Strip Claude Code's coding tools. Without this `-p` behaves as the full
    // agent — it enters plan mode and spends minutes "planning" a ticket instead
    // of answering. Tool-free, it's a text responder that only emits our blocks.
    cmd.args([
        "--disallowedTools",
        "Bash",
        "Edit",
        "Write",
        "Read",
        "Glob",
        "Grep",
        "WebFetch",
        "WebSearch",
        "Task",
        "TodoWrite",
        "NotebookEdit",
        "NotebookRead",
        "MultiEdit",
        "ExitPlanMode",
        "KillShell",
        "BashOutput",
    ]);
    if let Some(model) = model.as_deref().filter(|m| !m.is_empty()) {
        cmd.args(["--model", model]);
    }
    // `--system-prompt` replaces Claude Code's coding-oriented default with the
    // orchestrator role; the prompt (transcript) is the positional argument.
    cmd.args(["--system-prompt", &system]);
    cmd.arg(&prompt);

    // Clean env + the effective CLI env, skipping model-override prefixes that
    // would defeat `--model` alias resolution (mirrors claude/pty.rs).
    cmd.env_clear();
    for (key, value) in &env_map {
        if !MODEL_OVERRIDE_ENV_PREFIXES.iter().any(|p| key.starts_with(p)) {
            cmd.env(key, value);
        }
    }
    cmd.stdin(std::process::Stdio::null());

    let out = tokio::time::timeout(Duration::from_secs(180), cmd.output())
        .await
        .map_err(|_| "The Claude CLI timed out after 180s.".to_string())?
        .map_err(|e| format!("Failed to run claude: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.trim();
        return Err(if err.is_empty() {
            format!("claude exited with status {}", out.status)
        } else {
            err.to_string()
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
