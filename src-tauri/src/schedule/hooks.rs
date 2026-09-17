//! Claude Code hooks that report a scheduled run's progress back to trace.
//!
//! The PTY byte stream can't say "the turn is over" — an idle TUI still repaints,
//! and the renderer's quiet-timer also trips on pauses between tool calls. So
//! runs start with `--settings` carrying two hooks: `Stop` (the agent finished
//! its turn → the run is done) and `Notification` (Claude wants a human, usually
//! a permission prompt → the run needs input). Both call `trace-hook`, which
//! relays the event through the render bridge's loopback listener with the same
//! per-app token `trace-render` uses (`claude::render_bridge`).

use std::path::PathBuf;

use serde_json::json;

use crate::helpers::trace_bin_dir;

/// Always exits 0: a failing Stop hook must never keep Claude from stopping.
/// Reads its coordinates from the agent's env and carries no secret itself.
const HOOK_SCRIPT: &str = r#"#!/usr/bin/env bash
# trace-hook — relays a Claude Code hook event from a scheduled run to trace.
# Wired up by the --settings trace passes to scheduled runs; not for manual use.
if [ -z "${TRACE_RENDER_PORT:-}" ] || [ -z "${TRACE_RENDER_TOKEN:-}" ] || [ -z "${TRACE_ISSUE_KEY:-}" ]; then
  exit 0
fi
# '!' can't start a base64 payload, which is how the listener tells events apart.
msg="$TRACE_RENDER_TOKEN $TRACE_ISSUE_KEY !${1:-}"
if exec 3<>"/dev/tcp/127.0.0.1/$TRACE_RENDER_PORT" 2>/dev/null; then
  printf '%s\n' "$msg" >&3
  exec 3<&-
elif command -v nc >/dev/null 2>&1; then
  printf '%s\n' "$msg" | nc -w 1 127.0.0.1 "$TRACE_RENDER_PORT"
fi
exit 0
"#;

/// A hook event `trace-hook` may report. Anything else on the wire is ignored.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum HookEvent {
    Stop,
    NeedsInput,
}

impl HookEvent {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "stop" => Some(HookEvent::Stop),
            "needs-input" => Some(HookEvent::NeedsInput),
            _ => None,
        }
    }
}

/// Write `trace-hook` and return the `--settings` JSON that wires it up. Hooks
/// from `--settings` merge with the user's own, so theirs keep running too.
pub fn settings_arg() -> Result<String, String> {
    let script =
        write_script().map_err(|e| format!("Couldn't write the trace-hook script: {e}"))?;
    let command = shell_quote(&script.to_string_lossy());
    let hook = |event: &str| json!([{ "hooks": [{ "type": "command", "command": format!("{command} {event}") }] }]);
    Ok(
        json!({ "hooks": { "Stop": hook("stop"), "Notification": hook("needs-input") } })
            .to_string(),
    )
}

/// The config dir path has a space ("Application Support") — quote it for sh.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

fn write_script() -> std::io::Result<PathBuf> {
    let bin = trace_bin_dir();
    std::fs::create_dir_all(&bin)?;
    let path = bin.join("trace-hook");
    std::fs::write(&path, HOOK_SCRIPT)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(path)
}
