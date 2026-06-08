//! Interactive PTY transport for the Claude TUI.
//!
//! Hosts the *real* interactive `claude` TUI inside a pseudo-terminal — the same
//! thing a human gets running `claude` in a terminal. No `--print`/
//! `--output-format`, so it bills as interactive usage (the point of this
//! transport now that headless `-p` mode is being retired).
//!
//! Output is a raw ANSI byte stream painting a screen, not structured JSON — the
//! frontend renders it in an xterm.js pane. Adapted from the previous project's
//! `claude/pty.rs`, with the websocket dependency removed.

use std::collections::HashMap;
use std::io::{Read, Write};

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtyPair, PtySize};
use tauri::{AppHandle, Emitter, Manager};

use crate::claude::discovery::find_cli_with_env;
use crate::claude::env::{build_effective_cli_env, MODEL_OVERRIDE_ENV_PREFIXES};
use crate::state::AppState;

/// A live interactive Claude TUI hosted in a pseudo-terminal. Dropping `master`
/// closes the PTY and tears down the child, so keep it alive for the session.
pub struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

impl PtySession {
    /// Forward keystrokes / pasted text to the TUI.
    pub fn write_input(&mut self, data: &[u8]) -> std::io::Result<()> {
        self.writer.write_all(data)?;
        self.writer.flush()
    }

    /// Resize so the TUI re-lays-out to the visible xterm dimensions.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {e}"))
    }

    /// Terminate the child process (used by stop).
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyOutput {
    /// The owning issue/workspace — the frontend filters output by this.
    workspace_id: String,
    /// Base64-encoded raw PTY bytes (preserves ANSI + multibyte splits).
    data: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RunState {
    workspace_id: String,
    running: bool,
}

/// Spawn the interactive `claude` TUI inside a PTY rooted at `cwd`.
///
/// `claude_session_id` resumes an existing conversation; otherwise `new_session_id`
/// pins the id of a brand-new one (the raw byte stream gives no way to read back a
/// generated id, so we choose it up front and persist it for next launch).
///
/// A background thread pumps PTY output to the frontend (`pty-output`); on EOF it
/// emits `agent-run-state{running:false}` and removes the session from state.
#[allow(clippy::too_many_arguments)]
pub fn spawn_agent_pty(
    app: AppHandle,
    workspace_id: String,
    cwd: String,
    // Which CLI to run: "claude" or "codex".
    cli: String,
    claude_session_id: Option<String>,
    new_session_id: Option<String>,
    model: Option<String>,
    // Extra CLI flags the user configured (e.g. --dangerously-skip-permissions),
    // appended verbatim after the managed flags.
    extra_args: Vec<String>,
    env_overrides: HashMap<String, String>,
    cols: u16,
    rows: u16,
) -> Result<(PtySession, Option<u32>), String> {
    let effective_env = build_effective_cli_env(&env_overrides);
    let cli_path = find_cli_with_env(&cli, Some(&effective_env))
        .ok_or_else(|| format!("Could not find the `{cli}` CLI on PATH"))?;

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    // Interactive invocation. CLI-specific flag-building lives here; the env and
    // pump loop below are CLI-agnostic.
    let mut cmd = CommandBuilder::new(&cli_path);
    cmd.cwd(&cwd);
    match cli.as_str() {
        "claude" => {
            if let Some(model) = model.as_deref() {
                cmd.arg("--model");
                cmd.arg(model);
            }
            if let Some(sid) = claude_session_id.as_deref() {
                cmd.arg("--resume");
                cmd.arg(sid);
            } else if let Some(nsid) = new_session_id.as_deref() {
                cmd.arg("--session-id");
                cmd.arg(nsid);
            }
        }
        "codex" => {
            // Codex manages its own session state and uses different model flag
            // conventions across versions — invoke it bare for now and let it
            // pick up the user's defaults.
            let _ = (claude_session_id, new_session_id, model);
        }
        other => {
            return Err(format!("Unknown agent CLI: {other}"));
        }
    }
    // User-provided flags last, so they can override or extend the managed ones.
    for arg in &extra_args {
        cmd.arg(arg);
    }

    // Start from a clean env, apply the effective env, skip model-override
    // prefixes that would defeat the CLI's `--model` alias resolution.
    cmd.env_clear();
    for (key, value) in &effective_env {
        let dominated = MODEL_OVERRIDE_ENV_PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix));
        if !dominated {
            cmd.env(key, value);
        }
    }
    cmd.env("TERM", "xterm-256color");

    run_in_pty(app, workspace_id, pair, cmd)
}

/// Spawn an interactive login shell inside a PTY rooted at `cwd` — the "Terminal"
/// tab, a plain shell in the issue's worktree, distinct from the Claude agent in
/// the Chat tab. Inherits the user's environment (so their PATH/tools apply).
pub fn spawn_shell_pty(
    app: AppHandle,
    workspace_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(PtySession, Option<u32>), String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(default_shell());
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    run_in_pty(app, workspace_id, pair, cmd)
}

/// The user's interactive shell, platform-aware.
fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Spawn `cmd` against the PTY `pair`, register a pump thread that streams output
/// to the frontend and tears down state on EOF, and return the live session.
/// CLI-agnostic — shared by the agent and the plain-shell terminal.
fn run_in_pty(
    app: AppHandle,
    workspace_id: String,
    pair: PtyPair,
    cmd: CommandBuilder,
) -> Result<(PtySession, Option<u32>), String> {
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn process in PTY: {e}"))?;
    // Close the parent's copy of the slave fd so the reader sees EOF on exit.
    drop(pair.slave);
    let pid = child.process_id();

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let reader_app = app.clone();
    let reader_ws = workspace_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF — the process exited
                Ok(n) => {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = reader_app.emit(
                        "pty-output",
                        PtyOutput {
                            workspace_id: reader_ws.clone(),
                            data: encoded,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        // Process exited — drop session bookkeeping and tell the UI.
        if let Some(state) = reader_app.try_state::<AppState>() {
            state.pty_sessions.lock().remove(&reader_ws);
            state.child_pids.lock().remove(&reader_ws);
        }
        let _ = reader_app.emit(
            "agent-run-state",
            RunState {
                workspace_id: reader_ws.clone(),
                running: false,
            },
        );
    });

    Ok((
        PtySession {
            writer,
            master: pair.master,
            child,
        },
        pid,
    ))
}
