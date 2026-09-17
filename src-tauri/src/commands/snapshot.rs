//! Terminal scrollback for rebuilding an xterm after a renderer reload — or for
//! showing a finished scheduled run, whose history lives on disk
//! (`schedule::transcript`) rather than in memory.

use tauri::State;

use crate::schedule::{transcript, RUN_PREFIX};
use crate::state::AppState;

/// Everything needed to rebuild a terminal after a renderer reload: the
/// rolling output history plus the PTY size it was painted at. `None` when
/// the workspace never produced output (or its history was torn down).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySnapshot {
    pub chunks: Vec<String>,
    /// Highest seq included — live chunks at or below this are already here.
    pub seq: u64,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub fn pty_snapshot(state: State<'_, AppState>, workspace_id: String) -> Option<PtySnapshot> {
    {
        let histories = state.output_history.lock();
        if let Some(h) = histories
            .get(&workspace_id)
            .filter(|h| !h.chunks.is_empty())
        {
            return Some(PtySnapshot {
                chunks: h.chunks.iter().map(|(_, c)| c.clone()).collect(),
                seq: h.seq,
                cols: h.cols,
                rows: h.rows,
            });
        }
    }
    let saved = transcript::load(workspace_id.strip_prefix(RUN_PREFIX)?)?;
    Some(PtySnapshot {
        chunks: saved.chunks,
        seq: saved.seq,
        cols: saved.cols,
        rows: saved.rows,
    })
}
