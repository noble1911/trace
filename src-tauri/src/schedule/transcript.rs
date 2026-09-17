//! A finished run's terminal output on disk.
//!
//! While a run is live its scrollback sits in `AppState::output_history` like any
//! agent's. When it finishes that history is written here and dropped from
//! memory — a prompt firing every few minutes would otherwise pin megabytes per
//! run — and `pty_snapshot` serves it back, so an old run replays in xterm
//! exactly like a live one does after a reload, even across restarts.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::helpers::{restrict_perms, trace_dir};
use crate::state::OutputHistory;

/// Same shape as `commands::snapshot::PtySnapshot`.
#[derive(Serialize, Deserialize)]
pub struct Transcript {
    /// Base64 PTY chunks, oldest first.
    pub chunks: Vec<String>,
    pub seq: u64,
    /// The size the bytes were painted at — replay is only faithful at it.
    pub cols: u16,
    pub rows: u16,
}

impl From<&OutputHistory> for Transcript {
    fn from(h: &OutputHistory) -> Self {
        Self {
            chunks: h.chunks.iter().map(|(_, c)| c.clone()).collect(),
            seq: h.seq,
            cols: h.cols,
            rows: h.rows,
        }
    }
}

/// `None` for anything that isn't a plain run id — ids reach `load` from the
/// renderer, and must never be able to walk out of the transcripts dir.
fn path(run_id: &str) -> Option<PathBuf> {
    let safe = !run_id.is_empty()
        && run_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    safe.then(|| {
        trace_dir()
            .join("schedule-runs")
            .join(format!("{run_id}.json"))
    })
}

pub fn save(run_id: &str, transcript: &Transcript) -> Result<(), String> {
    let path = path(run_id).ok_or("Invalid run id.")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(transcript).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    restrict_perms(&path);
    Ok(())
}

pub fn load(run_id: &str) -> Option<Transcript> {
    let raw = std::fs::read_to_string(path(run_id)?).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn delete(run_id: &str) {
    if let Some(path) = path(run_id) {
        let _ = std::fs::remove_file(path);
    }
}
