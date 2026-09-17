//! Scheduled prompts — thin wrappers over `schedule::*` (prompts, runs, the
//! schedule preview, and handing a run off to a session).

use tauri::{AppHandle, Emitter};

use crate::commands::session::ScratchSession;
use crate::schedule::model::{PromptInput, ScheduleRun, ScheduledPrompt, Trigger};
use crate::schedule::timing::Schedule;
use crate::schedule::{handoff, now_secs, prompts, run, runner, store};

/// How many upcoming firings the form previews.
const PREVIEW_COUNT: usize = 3;

/// Every scheduled prompt, newest first.
#[tauri::command]
pub fn list_scheduled_prompts() -> Vec<ScheduledPrompt> {
    let mut list = store::prompts();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    list
}

/// Every run across all prompts, newest first.
#[tauri::command]
pub fn list_schedule_runs() -> Vec<ScheduleRun> {
    let mut runs = store::runs();
    runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    runs
}

#[tauri::command]
pub fn save_scheduled_prompt(
    app: AppHandle,
    input: PromptInput,
) -> Result<ScheduledPrompt, String> {
    let saved = prompts::save(input)?;
    let _ = app.emit("schedules-changed", ());
    Ok(saved)
}

#[tauri::command]
pub fn set_scheduled_prompt_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<ScheduledPrompt, String> {
    let updated = prompts::set_enabled(&id, enabled)?;
    let _ = app.emit("schedules-changed", ());
    Ok(updated)
}

/// Async + spawn_blocking: removing the worktree runs git, which must not block
/// the UI thread.
#[tauri::command]
pub async fn delete_scheduled_prompt(app: AppHandle, id: String) -> Result<(), String> {
    runner::ensure_leader()?;
    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || prompts::delete(&worker, &id))
        .await
        .map_err(|e| format!("delete failed: {e}"))??;
    let _ = app.emit("schedules-changed", ());
    Ok(())
}

/// Fire a prompt now, outside its schedule. Returns as soon as the run is
/// recorded — the worktree + spawn happen in the background.
#[tauri::command]
pub fn run_scheduled_prompt_now(app: AppHandle, id: String) -> Result<ScheduleRun, String> {
    runner::ensure_leader()?;
    run::start(&app, &id, Trigger::Manual)
}

#[tauri::command]
pub fn stop_scheduled_run(app: AppHandle, run_id: String) -> Result<(), String> {
    runner::ensure_leader()?;
    run::stop(&app, &run_id)
}

/// Validate a schedule and list its next firings (epoch secs) for the form.
/// `anchor_at` is the prompt's current anchor when editing an unchanged
/// interval; otherwise intervals count from now, as they will once saved.
#[tauri::command]
pub fn preview_schedule(schedule: Schedule, anchor_at: Option<i64>) -> Result<Vec<i64>, String> {
    schedule.validate()?;
    let now = now_secs();
    let anchor = anchor_at.unwrap_or(now);
    let mut out = Vec::with_capacity(PREVIEW_COUNT);
    let mut after = now;
    while out.len() < PREVIEW_COUNT {
        let Some(next) = schedule.next_after(after, anchor) else {
            break;
        };
        out.push(next);
        after = next;
    }
    Ok(out)
}

/// Turn a finished run into an exploratory session that resumes its conversation.
#[tauri::command]
pub fn continue_run_as_session(run_id: String) -> Result<ScratchSession, String> {
    handoff::continue_as_session(&run_id)
}
