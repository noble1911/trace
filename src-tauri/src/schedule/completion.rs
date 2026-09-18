//! Deciding when a scheduled run is actually done.
//!
//! Claude Code's `Stop` hook fires at the end of every *turn*, not when the work
//! is finished: a turn that launches background agents, shells or workflows
//! ends straight away and is woken again as each one reports. Finishing on that
//! first Stop killed the PTY — and the background work inside it. So a run
//! finishes only when:
//!
//! 1. the Stop's `background_tasks` (the tasks the CLI still has running or
//!    pending) is empty — while it isn't, the run keeps going; and
//! 2. no new turn has started a few seconds later. A task that completed
//!    *during* the final turn is already off that list, but its result is still
//!    queued to wake Claude once more; that turn opens with a `user` entry in the
//!    conversation file (`transcript_path` in the hook input), after the offset
//!    captured when the Stop arrived — the CLI is still blocked on its Stop hooks
//!    then, so nothing from a new turn can already be there.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use super::model::RunStatus;
use super::{run, store};
use crate::claude::hooks::{HookEvent, HookInput};
use crate::state::AppState;

/// Quiet period after a final-looking Stop before tearing down: long enough for
/// a queued result to open a new turn, and for the TUI to paint the answer.
const SETTLE: Duration = Duration::from_secs(5);

/// Cap on the stored closing message — it's a summary, not the transcript.
const MAX_SUMMARY: usize = 4_000;

/// A turn event from a scheduled run's agent (already filtered and decoded by
/// `claude::hooks`). Ignores runs that aren't live.
pub fn on_turn(app: &AppHandle, ws: &str, event: HookEvent, input: HookInput) {
    let live = {
        let state = app.state::<AppState>();
        let mut runs = state.live_runs.lock();
        let Some(live) = runs.get_mut(ws) else {
            return;
        };
        if event == HookEvent::Stop {
            live.stops += 1;
        }
        live.clone()
    };
    match event {
        HookEvent::Stop => on_stop(app, ws, &live, input),
        HookEvent::NeedsInput => mark_needs_input(app, &live.run_id),
    }
}

fn on_stop(app: &AppHandle, ws: &str, live: &run::LiveRun, input: HookInput) {
    let pending = input.pending_tasks();
    // The closing message of each turn, so the latest is the run's answer.
    let summary = input
        .last_assistant_message
        .as_deref()
        .map(|m| m.trim().chars().take(MAX_SUMMARY).collect::<String>());
    let updated = store::update_run(&live.run_id, |r| {
        r.background_tasks = pending;
        if let Some(summary) = summary {
            if !summary.is_empty() {
                r.summary = summary;
            }
        }
    });
    if let Ok(Some(run)) = updated {
        run::emit(app, &run);
    }
    if pending > 0 {
        return;
    }
    let offset = input
        .transcript_path
        .as_deref()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len());
    let (app, ws, stops) = (app.clone(), ws.to_string(), live.stops);
    std::thread::spawn(move || {
        std::thread::sleep(SETTLE);
        // A later Stop supersedes this check (and runs its own).
        let current = app
            .state::<AppState>()
            .live_runs
            .lock()
            .get(&ws)
            .map(|r| r.stops);
        if current != Some(stops) {
            return;
        }
        let resumed = match (input.transcript_path.as_deref(), offset) {
            (Some(path), Some(offset)) => {
                appended_since(path, offset).is_some_and(|t| opens_turn(&t))
            }
            _ => false,
        };
        if !resumed {
            run::finish(&app, &ws, RunStatus::Succeeded, None);
        }
    });
}

fn mark_needs_input(app: &AppHandle, run_id: &str) {
    let already = store::runs()
        .iter()
        .any(|r| r.id == run_id && r.needs_input);
    if already {
        return;
    }
    if let Ok(Some(run)) = store::update_run(run_id, |r| r.needs_input = true) {
        run::emit(app, &run);
    }
}

/// Whatever the conversation file gained past `offset`.
fn appended_since(path: &str, offset: u64) -> Option<String> {
    let mut file = File::open(path).ok()?;
    file.seek(SeekFrom::Start(offset)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Whether appended conversation entries include a `user` one — how every turn
/// opens (a prompt, a queued task result, a blocking hook's reason). Bookkeeping
/// written while idle (`system`, `cost-state`, `last-prompt`, …) and a late flush
/// of the finished turn's own `assistant` message don't count.
fn opens_turn(appended: &str) -> bool {
    #[derive(Deserialize)]
    struct Entry {
        #[serde(rename = "type")]
        kind: String,
    }
    appended
        .lines()
        .filter_map(|line| serde_json::from_str::<Entry>(line).ok())
        .any(|entry| entry.kind == "user")
}

#[cfg(test)]
mod tests {
    use super::opens_turn;

    #[test]
    fn only_a_user_entry_opens_a_new_turn() {
        let idle = concat!(
            r#"{"type":"system","subtype":"stop_hook_summary"}"#,
            "\n",
            r#"{"type":"system","subtype":"turn_duration"}"#,
            "\n",
            r#"{"type":"cost-state","total":1}"#,
            "\n",
            r#"{"type":"assistant","message":{"content":"late flush"}}"#,
            "\n",
            r#"{"type":"last-prompt"}"#,
            "\n",
        );
        assert!(!opens_turn(idle));
        let resumed = format!(
            "{idle}{}\n",
            r#"{"type":"user","message":{"content":"<task-notification>"}}"#
        );
        assert!(opens_turn(&resumed));
        // A torn final line is skipped, not misread.
        assert!(!opens_turn(r#"{"type":"us"#));
    }
}
