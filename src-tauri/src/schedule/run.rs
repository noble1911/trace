//! One scheduled run, start to finish.
//!
//! Start: reserve the prompt (one live run each), record the run, then — on a
//! worker thread, since worktree creation takes seconds — render the prompt and
//! spawn a fresh Claude conversation keyed `sched:<runId>`. Finish: whichever comes first of the work being
//! done (`completion`), a timeout, a stop, or the process exiting saves the
//! transcript, frees the in-memory scrollback, kills the PTY and records the
//! outcome.

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use super::model::{RunStatus, ScheduleRun, ScheduledPrompt, Trigger};
use super::transcript::{self, Transcript};
use super::{now_secs, run_workspace_id, store, template};
use crate::claude::conversations::{forget_session_id, session_id_for};
use crate::commands::agent::spawn_in;
use crate::commands::session_agents::stop_agents;
use crate::git;
use crate::helpers::{new_id, slugify};
use crate::state::AppState;

/// A run whose PTY is live or about to be. Held in `AppState::live_runs`, keyed
/// by the run's workspace id.
#[derive(Clone)]
pub struct LiveRun {
    pub run_id: String,
    pub prompt_id: String,
    /// Epoch secs after which the run is killed as timed out; `None` = no limit.
    pub deadline: Option<i64>,
    /// False while the worktree/spawn step is still going — until then a missing
    /// PTY means "not started yet", not "exited".
    pub spawned: bool,
    /// Stop hooks seen so far. A pending "is it done?" check only acts if no
    /// later Stop arrived meanwhile (`completion`).
    pub stops: u64,
}

/// `schedule-run` event payload: a run started, changed, or finished.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunEvent {
    prompt_id: String,
    run_id: String,
    status: RunStatus,
    needs_input: bool,
}

/// The PTY size a run starts at; the renderer resizes it once someone watches.
const COLS: u16 = 120;
const ROWS: u16 = 36;

/// Start a run of `prompt_id`. Errors when the prompt is gone or already
/// running; anything failing after that is recorded on the run itself.
pub fn start(app: &AppHandle, prompt_id: &str, trigger: Trigger) -> Result<ScheduleRun, String> {
    let prompt = store::prompt(prompt_id).ok_or("That scheduled prompt no longer exists.")?;
    let state = app.state::<AppState>();
    let now = now_secs();
    let run = ScheduleRun {
        id: new_id(),
        prompt_id: prompt.id.clone(),
        trigger,
        status: RunStatus::Running,
        started_at: now,
        ended_at: None,
        prompt: String::new(),
        claude_session_id: None,
        needs_input: false,
        skipped: 0,
        background_tasks: 0,
        summary: String::new(),
        error: None,
        has_transcript: false,
    };
    let ws = run_workspace_id(&run.id);
    {
        // Check-and-reserve under one lock, so the ticker and "Run now" can't
        // both launch the same prompt.
        let mut live = state.live_runs.lock();
        if live.values().any(|r| r.prompt_id == prompt.id) {
            return Err("This prompt is already running.".to_string());
        }
        let deadline = (prompt.timeout_mins > 0).then(|| now + i64::from(prompt.timeout_mins) * 60);
        let reservation = LiveRun {
            run_id: run.id.clone(),
            prompt_id: prompt.id.clone(),
            deadline,
            spawned: false,
            stops: 0,
        };
        live.insert(ws.clone(), reservation);
    }
    let recorded = store::push_run(run.clone()).and_then(|()| {
        store::update_prompts(|list| {
            if let Some(p) = list.iter_mut().find(|p| p.id == prompt.id) {
                p.last_run_at = Some(now);
            }
        })
    });
    if let Err(err) = recorded {
        state.live_runs.lock().remove(&ws);
        return Err(err);
    }
    emit(app, &run);
    let worker = app.clone();
    let launched = run.clone();
    std::thread::spawn(move || launch(&worker, &prompt, &launched));
    Ok(run)
}

fn launch(app: &AppHandle, prompt: &ScheduledPrompt, run: &ScheduleRun) {
    let ws = run_workspace_id(&run.id);
    let (rendered, claude_id) = match spawn(app, prompt, run) {
        Ok(spawned) => spawned,
        Err(err) => return finish(app, &ws, RunStatus::Failed, Some(err)),
    };
    let state = app.state::<AppState>();
    let still_wanted = match state.live_runs.lock().get_mut(&ws) {
        Some(live) => {
            live.spawned = true;
            true
        }
        None => false,
    };
    let _ = store::update_run(&run.id, |r| {
        r.prompt = rendered;
        r.claude_session_id = claude_id;
    });
    if !still_wanted {
        // Stopped (or its prompt deleted) while the worktree was being made.
        stop_agents(&state, std::slice::from_ref(&ws));
        state.output_history.lock().remove(&ws);
        return;
    }
    // Backend-started, so the renderer hasn't marked it running itself.
    let _ = app.emit(
        "agent-run-state",
        json!({ "workspaceId": ws, "running": true }),
    );
}

/// Make sure the worktree exists and spawn the agent. Returns the rendered
/// prompt and the conversation id.
fn spawn(
    app: &AppHandle,
    prompt: &ScheduledPrompt,
    run: &ScheduleRun,
) -> Result<(String, Option<String>), String> {
    let repo = prompt
        .repo
        .clone()
        .or_else(crate::commands::repos::default_repo)
        .ok_or("Add a repository in Settings first.")?;
    let cwd = ensure_worktree(&repo, &prompt.id)?;
    let previous_run = store::runs()
        .into_iter()
        .filter(|r| r.prompt_id == prompt.id && r.id != run.id)
        .map(|r| r.started_at)
        .max();
    let vars = template::Vars {
        now: run.started_at,
        last_run_at: previous_run,
        title: &prompt.title,
        repo: &repo,
    };
    let rendered = template::render(&prompt.prompt, &vars);
    // `spawn_in` attaches the turn hooks (`claude::hooks`) that tell us when the
    // run's work is done.
    let args = prompt.extra_args.clone();
    let ws = run_workspace_id(&run.id);
    let state = app.state::<AppState>();
    spawn_in(
        app.clone(),
        &state,
        ws.clone(),
        cwd,
        "claude".to_string(),
        prompt.model.clone(),
        args,
        Some(rendered.clone()),
        prompt.provider.clone(),
        COLS,
        ROWS,
    )?;
    // `spawn_in` pinned a fresh conversation id under the workspace id. Keep it
    // on the run record instead, so `sessions.json` doesn't grow an entry per run.
    let claude_id = session_id_for(&ws);
    let _ = forget_session_id(&ws);
    Ok((rendered, claude_id))
}

/// The prompt's worktree: `<repo>/.worktrees/<slug>`, created on first run.
fn ensure_worktree(repo: &str, prompt_id: &str) -> Result<String, String> {
    let worktree = crate::commands::repos::workspace_dir(repo, prompt_id);
    if std::path::Path::new(&worktree).exists() {
        return Ok(worktree);
    }
    let busy = git::git_busy_check(repo);
    if busy.starts_with("busy") {
        return Err(format!(
            "Repository is {busy} — finish that git operation first."
        ));
    }
    let branch = format!("workspace/{}", slugify(prompt_id));
    git::create_worktree(repo, &worktree, &branch, &git::get_default_branch(repo))?;
    Ok(worktree)
}

/// Record a run's outcome and tear it down. Idempotent: whoever removes the live
/// entry first (Stop hook, timeout, stop, exit) decides the status.
pub fn finish(app: &AppHandle, ws: &str, status: RunStatus, error: Option<String>) {
    let state = app.state::<AppState>();
    let Some(live) = state.live_runs.lock().remove(ws) else {
        return;
    };
    // Copy the scrollback before the kill (teardown bytes add nothing), but only
    // drop the history after it: the pump thread treats a missing entry as "torn
    // down" and would bail out ahead of the kill (same order as `discard_agents`).
    let saved = state
        .output_history
        .lock()
        .get(ws)
        .filter(|h| !h.chunks.is_empty())
        .map(Transcript::from);
    stop_agents(&state, &[ws.to_string()]);
    state.output_history.lock().remove(ws);
    let has_transcript = saved.is_some_and(|t| transcript::save(&live.run_id, &t).is_ok());
    let ended_at = now_secs();
    let updated = store::update_run(&live.run_id, |r| {
        r.status = status;
        r.ended_at = Some(ended_at);
        r.has_transcript = has_transcript;
        if error.is_some() {
            r.error = error;
        }
        if status == RunStatus::Succeeded {
            r.needs_input = false;
            r.background_tasks = 0;
        }
    });
    if let Ok(Some(run)) = updated {
        emit(app, &run);
    }
}

/// Stop a run from the UI. A record left "running" by a crash has no live PTY —
/// just close it out.
pub fn stop(app: &AppHandle, run_id: &str) -> Result<(), String> {
    let ws = run_workspace_id(run_id);
    if app.state::<AppState>().live_runs.lock().contains_key(&ws) {
        finish(app, &ws, RunStatus::Stopped, None);
        return Ok(());
    }
    let updated = store::update_run(run_id, |r| {
        if r.status == RunStatus::Running {
            r.status = RunStatus::Stopped;
            r.ended_at = Some(now_secs());
        }
    })?;
    if let Some(run) = updated {
        emit(app, &run);
    }
    Ok(())
}

/// The live run's workspace id for a prompt, if one is going.
pub fn live_workspace_for(app: &AppHandle, prompt_id: &str) -> Option<String> {
    let state = app.state::<AppState>();
    let live = state.live_runs.lock();
    live.iter()
        .find(|(_, r)| r.prompt_id == prompt_id)
        .map(|(ws, _)| ws.clone())
}

/// A firing came due while the prompt's previous run was still going.
pub fn note_skipped(app: &AppHandle, ws: &str) {
    let Some(run_id) = app
        .state::<AppState>()
        .live_runs
        .lock()
        .get(ws)
        .map(|r| r.run_id.clone())
    else {
        return;
    };
    if let Ok(Some(run)) = store::update_run(&run_id, |r| r.skipped += 1) {
        emit(app, &run);
    }
}

/// Tell the renderer a run changed (it re-loads and may notify).
pub(crate) fn emit(app: &AppHandle, run: &ScheduleRun) {
    let event = RunEvent {
        prompt_id: run.prompt_id.clone(),
        run_id: run.id.clone(),
        status: run.status,
        needs_input: run.needs_input,
    };
    let _ = app.emit("schedule-run", event);
}
