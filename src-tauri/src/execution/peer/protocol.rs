//! What two traces say to each other over a peer connection, and what the
//! mobile apps will say to a trace later (`docs/REMOTE_EXECUTION_PLAN.md`).
//!
//! JSON text frames over a WebSocket, one message per frame, each tagged by
//! `type`. Nothing here is specific to Tauri or the renderer: a phone has to be
//! able to speak it. Terminal bytes travel base64-encoded, exactly as the
//! renderer already gets them in `pty-output`, so ANSI and split multibyte
//! characters survive.
//!
//! A connection opens with [`Request::Hello`] and is refused unless its token
//! matches. A request the server doesn't know gets an error reply rather than a
//! dropped connection, so a newer client can talk to an older trace and find out
//! what it can't do.

use serde::{Deserialize, Serialize};

use super::capabilities::ServerCapabilities;

/// Bumped when a message changes meaning. Adding a message type doesn't bump
/// it: an older side answers an unknown one with an error.
pub const PROTOCOL_VERSION: u32 = 1;

/// The port every trace serves on and probes, so peers find each other by address alone.
pub const PEER_PORT: u16 = 47821;

/// A request from a client, with an id the server echoes on what answers it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<u64>,
    #[serde(flatten)]
    pub request: Request,
}

/// Client → server.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Request {
    /// The first message on every connection.
    #[serde(rename_all = "camelCase")]
    Hello {
        protocol: u32,
        /// The pairing token. Never logged or echoed.
        token: String,
        /// Shown on the server, e.g. "Ron's MacBook".
        client_name: String,
    },
    /// The agents running on the server.
    List,
    /// Start a new session on the server, in one of the repos its `Welcome`
    /// listed. Answered with [`Event::Spawned`], then attach to follow it.
    #[serde(rename_all = "camelCase")]
    Spawn {
        /// A name from `capabilities.repos`, never a path.
        repo: String,
        /// "claude" | "codex", one of `capabilities.agents`.
        cli: String,
        #[serde(default)]
        prompt: Option<String>,
        #[serde(default)]
        title: Option<String>,
        cols: u16,
        rows: u16,
    },
    /// Start receiving a workspace's output, replaying what came after
    /// `from_seq` (0 for everything the server still has).
    #[serde(rename_all = "camelCase")]
    Attach { workspace_id: String, from_seq: u64 },
    /// Stop receiving it. The agent keeps running.
    #[serde(rename_all = "camelCase")]
    Detach { workspace_id: String },
    /// Keystrokes or pasted text, base64.
    #[serde(rename_all = "camelCase")]
    Input { workspace_id: String, data: String },
    /// Whoever resizes last sets the size, as in a shared tmux session.
    #[serde(rename_all = "camelCase")]
    Resize {
        workspace_id: String,
        cols: u16,
        rows: u16,
    },
    /// End the agent, for everyone watching it.
    #[serde(rename_all = "camelCase")]
    Stop { workspace_id: String },
}

/// One agent the server runs, as `List` reports it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSession {
    pub workspace_id: String,
    /// The session's or ticket's title, when the server knows one.
    #[serde(default)]
    pub title: Option<String>,
    /// Whether a turn is in progress, as far as the server's hooks know.
    #[serde(default)]
    pub busy: bool,
}

/// Server → client.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    /// The answer to a good `Hello`: what this server is and can do.
    Welcome { capabilities: ServerCapabilities },
    /// A `Spawn` worked; `workspace_id` is what to attach to.
    #[serde(rename_all = "camelCase")]
    Spawned {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
        workspace_id: String,
    },
    /// The connection is closing: a bad token or an unsupported protocol.
    Refused { reason: String },
    #[serde(rename_all = "camelCase")]
    Sessions {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
        sessions: Vec<RemoteSession>,
    },
    /// Sent before an attach's replay. `reset` means the server no longer has
    /// everything after `from_seq`, so the client clears its screen first and
    /// replays at `cols`×`rows`, the size the bytes were painted for.
    #[serde(rename_all = "camelCase")]
    Attached {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
        workspace_id: String,
        reset: bool,
        cols: u16,
        rows: u16,
    },
    /// Terminal bytes, base64. `seq` matches the server's `pty-output` and
    /// restarts at 1 on every run, like it.
    #[serde(rename_all = "camelCase")]
    Output {
        workspace_id: String,
        seq: u64,
        data: String,
    },
    /// The agent started or stopped. `exited` means it ended on its own.
    #[serde(rename_all = "camelCase")]
    RunState {
        workspace_id: String,
        running: bool,
        exited: bool,
    },
    /// A turn ended, or the agent is blocked on a person. The server's
    /// `agent-turn`, so a phone can show what needs you without a terminal.
    #[serde(rename_all = "camelCase")]
    Turn {
        workspace_id: String,
        /// "stop" | "needsInput".
        event: String,
        #[serde(default)]
        background_tasks: u32,
        #[serde(default)]
        notification_type: Option<String>,
        #[serde(default)]
        message: Option<String>,
        #[serde(default)]
        last_message: Option<String>,
    },
    /// A request failed. `id` is the request's, when it had one.
    #[serde(rename_all = "camelCase")]
    Error {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<u64>,
        message: String,
    },
}

/// Read one client frame. A frame that isn't a request this side knows still
/// yields its `id`, so the error can be addressed to it.
pub fn parse_request(frame: &str) -> Result<Envelope, (Option<u64>, String)> {
    serde_json::from_str::<Envelope>(frame).map_err(|e| {
        let id = serde_json::from_str::<serde_json::Value>(frame)
            .ok()
            .and_then(|v| v.get("id").and_then(serde_json::Value::as_u64));
        (id, format!("Not a request this trace understands: {e}"))
    })
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
