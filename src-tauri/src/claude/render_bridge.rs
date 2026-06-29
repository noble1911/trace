//! Out-of-band HTML bridge for the agent's rich-output panel.
//!
//! A Claude agent can't push bytes onto its own chat PTY (Claude runs its Bash
//! tool in a captured, tty-less shell), so the OSC-in-the-terminal channel can't
//! be driven by the agent. Instead the agent runs `trace-render`, which opens a
//! loopback TCP connection to this listener; the listener validates a per-session
//! token and emits a `rich-html` Tauri event the frontend renders in the panel.
//!
//! Security: binds `127.0.0.1` only (never network-exposed), and every message
//! must carry a random per-app-session token, compared in constant time. The
//! token reaches agents only via their (user-private) process env, so other local
//! processes can't inject cards.

use std::io::{BufRead, BufReader, Read};
use std::net::{TcpListener, TcpStream};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::helpers::{new_id, trace_bin_dir};

/// The producer script trace places on every agent's PATH. It reads the bridge
/// coordinates from the agent's env (set in `commands::agent::spawn_in`) and
/// carries no secret itself. Accepts an HTML file arg or HTML on stdin.
const PRODUCER_SCRIPT: &str = r#"#!/usr/bin/env bash
# trace-render — render HTML in this agent's trace "Chat" panel.
#   trace-render report.html        # from a file
#   echo '<h2>Hi</h2>' | trace-render   # from stdin
set -euo pipefail

if [ -z "${TRACE_RENDER_PORT:-}" ] || [ -z "${TRACE_RENDER_TOKEN:-}" ] || [ -z "${TRACE_ISSUE_KEY:-}" ]; then
  echo "trace-render: not running inside a trace agent (TRACE_RENDER_* unset)" >&2
  exit 1
fi

if [ "$#" -ge 1 ]; then
  html="$(cat "$1")"
else
  html="$(cat)"
fi

# base64 keeps the payload on one space-free, newline-free line so the listener
# can frame the message as "<token> <issueKey> <payload>".
payload="$(printf '%s' "$html" | base64 | tr -d '\n')"
msg="$TRACE_RENDER_TOKEN $TRACE_ISSUE_KEY $payload"

# Prefer bash's /dev/tcp (no external tool); fall back to nc.
if exec 3<>"/dev/tcp/127.0.0.1/$TRACE_RENDER_PORT" 2>/dev/null; then
  printf '%s\n' "$msg" >&3
  exec 3<&-
elif command -v nc >/dev/null 2>&1; then
  printf '%s\n' "$msg" | nc -w 1 127.0.0.1 "$TRACE_RENDER_PORT"
else
  echo "trace-render: cannot reach trace (no /dev/tcp or nc)" >&2
  exit 1
fi
"#;

/// Cap a single message at ~8 MiB of base64 (~6 MiB of HTML) so a malformed or
/// hostile client can't exhaust memory on one line.
const MAX_MESSAGE_BYTES: u64 = 8 * 1024 * 1024;

/// Coordinates an agent needs to reach the bridge. Stored once in `AppState`.
/// `port == 0` marks a disabled bridge (bind failed) — callers skip env injection.
#[derive(Clone, Default)]
pub struct RenderBridge {
    pub port: u16,
    pub token: String,
}

/// Tauri event payload — `issueKey` matches the frontend store's keying.
#[derive(Clone, Serialize)]
struct RichHtml {
    #[serde(rename = "issueKey")]
    issue_key: String,
    html: String,
}

/// Bind the loopback listener, write the producer script, and spawn the accept
/// loop. Returns the port + token to inject into agent envs. Errors propagate so
/// the caller can store a disabled bridge instead.
pub fn start(app: AppHandle) -> std::io::Result<RenderBridge> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let token = new_id();
    let bridge = RenderBridge { port, token: token.clone() };

    // Best-effort: a missing script just means agents lack the convenience CLI.
    let _ = write_producer_script();

    // A plain OS thread (not tokio) per the project's PTY-pump convention.
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let app = app.clone();
            let token = token.clone();
            std::thread::spawn(move || handle_conn(stream, &app, &token));
        }
    });

    Ok(bridge)
}

/// Read one framed message, authenticate it, and emit the event. Anything
/// malformed is dropped silently — this endpoint is fed by untrusted local input.
fn handle_conn(stream: TcpStream, app: &AppHandle, token: &str) {
    let mut line = String::new();
    if BufReader::new(stream)
        .take(MAX_MESSAGE_BYTES)
        .read_line(&mut line)
        .is_err()
    {
        return;
    }
    let mut parts = line.trim_end().splitn(3, ' ');
    let (Some(got_token), Some(issue_key), Some(b64)) =
        (parts.next(), parts.next(), parts.next())
    else {
        return;
    };
    if !constant_time_eq(got_token.as_bytes(), token.as_bytes()) {
        return;
    }
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) else {
        return;
    };
    let Ok(html) = String::from_utf8(bytes) else {
        return;
    };
    let _ = app.emit("rich-html", RichHtml { issue_key: issue_key.to_string(), html });
}

/// Constant-time byte comparison so a token check can't be timed. (The length is
/// not secret — the token is a fixed-width UUID — so an early length bail is fine.)
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Write the `trace-render` producer to trace's bin dir and mark it executable.
/// The script holds no secret (it reads the token from env), so 0755 is fine.
fn write_producer_script() -> std::io::Result<()> {
    let bin = trace_bin_dir();
    std::fs::create_dir_all(&bin)?;
    let path = bin.join("trace-render");
    std::fs::write(&path, PRODUCER_SCRIPT)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}
