//! What a connection needs from the trace it is served by. The server and its
//! protocol handling talk to this, not to Tauri, so they run in tests against a
//! fake, and a headless server could later supply its own (`app_backend` is this
//! trace's).

use std::collections::VecDeque;

use super::capabilities::ServerCapabilities;
use super::protocol::RemoteSession;

/// A new session a peer asked for.
#[derive(Debug, Clone)]
pub struct SpawnRequest {
    pub repo: String,
    pub cli: String,
    pub prompt: Option<String>,
    pub title: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// What an attach replays.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Replay {
    /// The server no longer has everything after the client's `from_seq`.
    pub reset: bool,
    pub cols: u16,
    pub rows: u16,
    /// (seq, base64), oldest first.
    pub chunks: Vec<(u64, String)>,
    /// The seq of the last chunk in history; live output resumes after it.
    pub last_seq: u64,
}

pub trait Backend: Send + Sync {
    /// The server's pairing token. Read for each connection, so rotating it
    /// takes effect for the next one.
    fn token(&self) -> Result<String, String>;
    fn capabilities(&self) -> ServerCapabilities;
    fn sessions(&self) -> Vec<RemoteSession>;
    /// Make a session and start its agent. Returns its workspace id.
    fn spawn(&self, request: SpawnRequest) -> Result<String, String>;
    /// None when there is no such agent, and nothing of one to replay.
    fn replay(&self, workspace_id: &str, from_seq: u64) -> Option<Replay>;
    fn input(&self, workspace_id: &str, data: &[u8]) -> Result<(), String>;
    /// One PTY serves every viewer, so whoever resizes last sets the size.
    fn resize(&self, workspace_id: &str, cols: u16, rows: u16) -> Result<(), String>;
    fn stop(&self, workspace_id: &str) -> Result<(), String>;
}

/// Whether a peer may see or drive this workspace: agents, not the plain shell
/// beside one (the Terminal tab), which the server never lists or serves.
pub fn is_served(workspace_id: &str) -> bool {
    !workspace_id.starts_with("term:")
}

/// What to send a client that has seen up to `from_seq`, from a history of
/// `chunks` that ends at `seq`. A client that is ahead of the server (the run
/// restarted and its seq began again) or behind what the server kept starts over.
pub fn plan_replay(
    chunks: &VecDeque<(u64, String)>,
    seq: u64,
    cols: u16,
    rows: u16,
    from_seq: u64,
) -> Replay {
    let oldest = chunks.front().map_or(seq + 1, |(s, _)| *s);
    let reset = from_seq > seq || oldest > from_seq + 1;
    let after = if reset { 0 } else { from_seq };
    Replay {
        reset,
        cols,
        rows,
        chunks: chunks.iter().filter(|(s, _)| *s > after).cloned().collect(),
        last_seq: seq,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn history(range: std::ops::RangeInclusive<u64>) -> VecDeque<(u64, String)> {
        range.map(|s| (s, format!("c{s}"))).collect()
    }

    #[test]
    fn a_client_that_is_caught_up_gets_only_what_it_missed() {
        let r = plan_replay(&history(1..=5), 5, 80, 24, 3);
        assert!(!r.reset);
        assert_eq!(r.chunks.iter().map(|c| c.0).collect::<Vec<_>>(), [4, 5]);
        assert_eq!(r.last_seq, 5);
    }

    #[test]
    fn a_new_client_gets_everything_and_no_reset_if_nothing_was_evicted() {
        let r = plan_replay(&history(1..=3), 3, 80, 24, 0);
        assert!(!r.reset);
        assert_eq!(r.chunks.len(), 3);
    }

    #[test]
    fn evicted_history_means_start_over_with_all_that_is_left() {
        let r = plan_replay(&history(40..=50), 50, 100, 30, 10);
        assert!(r.reset);
        assert_eq!(r.chunks.len(), 11);
        assert_eq!((r.cols, r.rows), (100, 30));
    }

    #[test]
    fn a_client_ahead_of_a_restarted_run_starts_over() {
        let r = plan_replay(&history(1..=2), 2, 80, 24, 900);
        assert!(r.reset);
        assert_eq!(r.chunks.len(), 2);
    }
}
