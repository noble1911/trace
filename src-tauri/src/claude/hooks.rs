//! Claude Code hooks that report every agent's turns back to trace.
//!
//! The PTY byte stream can't say "the turn is over" or "Claude is waiting on
//! background work": an idle TUI still repaints, and one waiting on background
//! agents or workflows goes as quiet as one waiting on you. So every Claude agent
//! starts with `--settings` carrying two hooks — `Stop` (a turn ended; its input
//! lists the background tasks still pending) and `Notification` (Claude may want
//! a human, e.g. a permission prompt). Both call `trace-hook`, which relays the
//! event plus the hook's JSON input through the render bridge's loopback listener
//! with the same per-app token `trace-render` uses (`claude::render_bridge`).
//!
//! `on_hook` forwards each turn to the renderer (`agent-turn`), which uses it to
//! tell "needs you" from "busy in the background", and to the scheduler for
//! scheduled runs, whose lifecycle ends when the work does (`schedule::completion`).

use std::path::PathBuf;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::helpers::trace_bin_dir;

/// Always exits 0: a failing Stop hook must never keep Claude from stopping.
/// Reads its coordinates from the agent's env and carries no secret itself.
const HOOK_SCRIPT: &str = r#"#!/usr/bin/env bash
# trace-hook — relays a Claude Code hook event from a trace agent to trace.
# Wired up by the --settings trace passes to its agents; not for manual use.
if [ -z "${TRACE_RENDER_PORT:-}" ] || [ -z "${TRACE_RENDER_TOKEN:-}" ] || [ -z "${TRACE_ISSUE_KEY:-}" ]; then
  exit 0
fi
# The hook's JSON input rides along base64-encoded, keeping the message one line.
payload=""
if [ ! -t 0 ]; then
  payload="$(base64 | tr -d '\n')"
fi
# '!' can't start a base64 payload, which is how the listener tells events apart.
msg="$TRACE_RENDER_TOKEN $TRACE_ISSUE_KEY !${1:-} $payload"
if exec 3<>"/dev/tcp/127.0.0.1/$TRACE_RENDER_PORT" 2>/dev/null; then
  printf '%s\n' "$msg" >&3
  exec 3<&-
elif command -v nc >/dev/null 2>&1; then
  printf '%s\n' "$msg" | nc -w 1 127.0.0.1 "$TRACE_RENDER_PORT"
fi
exit 0
"#;

/// Notification types that mean Claude is blocked on a human. Others
/// (`idle_prompt` while background agents work, `agent_completed`, …) aren't.
const ASKS_FOR_HUMAN: [&str; 5] = [
    "permission_prompt",
    "elicitation_dialog",
    "elicitation_url_dialog",
    "agent_needs_input",
    "worker_permission_prompt",
];

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

/// The parts of a hook's JSON input trace uses. All optional: older CLIs send less.
#[derive(Deserialize, Default)]
pub struct HookInput {
    pub background_tasks: Option<Vec<serde_json::Value>>,
    /// Claude's closing message for the turn that just ended.
    pub last_assistant_message: Option<String>,
    pub transcript_path: Option<String>,
    pub notification_type: Option<String>,
}

impl HookInput {
    /// Background tasks still running/pending at a Stop. A CLI too old to report
    /// them counts as none — the pre-hook behaviour.
    pub fn pending_tasks(&self) -> u32 {
        let n = self.background_tasks.as_ref().map_or(0, Vec::len);
        u32::try_from(n).unwrap_or(u32::MAX)
    }

    /// Whether a Notification means Claude is blocked on a human. An untyped one
    /// (older CLI) is assumed to be.
    pub fn asks_for_human(&self) -> bool {
        self.notification_type
            .as_deref()
            .is_none_or(|t| ASKS_FOR_HUMAN.contains(&t))
    }
}

/// `agent-turn` event payload.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTurn<'a> {
    workspace_id: &'a str,
    /// "stop" (a turn ended) | "needsInput" (Claude is blocked on the user).
    event: &'a str,
    /// Background tasks still pending at a Stop; 0 otherwise.
    background_tasks: u32,
}

/// Write `trace-hook` and return the `--settings` JSON that wires it up. Hooks
/// from `--settings` merge with the user's own, so theirs keep running too.
pub fn settings_arg() -> Result<String, String> {
    let script =
        write_script().map_err(|e| format!("Couldn't write the trace-hook script: {e}"))?;
    let command = shell_quote(&script.to_string_lossy());
    let hook = |event: &str| json!([{ "hooks": [{ "type": "command", "command": format!("{command} {event}") }] }]);
    let settings =
        json!({ "hooks": { "Stop": hook("stop"), "Notification": hook("needs-input") } });
    Ok(settings.to_string())
}

/// A hook event relayed through the render bridge: `"<event> <base64 hook input>"`
/// from agent `ws`. Uninteresting notifications (`idle_prompt`, …) are dropped here.
pub fn on_hook(app: &AppHandle, ws: &str, message: &str) {
    let (name, payload) = message.split_once(' ').unwrap_or((message, ""));
    let Some(event) = HookEvent::parse(name) else {
        return;
    };
    let input = decode(payload);
    let turn = match event {
        HookEvent::Stop => AgentTurn {
            workspace_id: ws,
            event: "stop",
            background_tasks: input.pending_tasks(),
        },
        HookEvent::NeedsInput if input.asks_for_human() => AgentTurn {
            workspace_id: ws,
            event: "needsInput",
            background_tasks: 0,
        },
        HookEvent::NeedsInput => return,
    };
    let _ = app.emit("agent-turn", turn);
    if ws.starts_with(crate::schedule::RUN_PREFIX) {
        crate::schedule::completion::on_turn(app, ws, event, input);
    }
}

fn decode(payload: &str) -> HookInput {
    base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
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

#[cfg(test)]
mod tests {
    use super::decode;
    use base64::Engine;

    #[test]
    fn decodes_hook_input_and_tolerates_junk() {
        let json = r#"{"hook_event_name":"Stop","background_tasks":[{"id":"a","type":"subagent","status":"running"}],"transcript_path":"/t.jsonl"}"#;
        let input = decode(&base64::engine::general_purpose::STANDARD.encode(json));
        assert_eq!(input.pending_tasks(), 1);
        assert_eq!(input.transcript_path.as_deref(), Some("/t.jsonl"));
        // Older CLIs / empty stdin: nothing to go on, but no panic.
        assert_eq!(decode("").pending_tasks(), 0);
        assert!(decode("not base64!").transcript_path.is_none());
    }

    #[test]
    fn only_blocking_notifications_ask_for_a_human() {
        let typed = |t: &str| {
            let json = format!(r#"{{"notification_type":"{t}"}}"#);
            decode(&base64::engine::general_purpose::STANDARD.encode(json))
        };
        assert!(typed("permission_prompt").asks_for_human());
        assert!(typed("worker_permission_prompt").asks_for_human());
        assert!(!typed("idle_prompt").asks_for_human());
        assert!(!typed("agent_completed").asks_for_human());
        // Untyped (older CLI): assume it does, as before.
        assert!(decode("").asks_for_human());
    }
}
