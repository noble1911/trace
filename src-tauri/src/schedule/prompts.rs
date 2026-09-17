//! Create / edit / pause / delete scheduled prompts — the operations behind
//! `commands::schedules`.

use tauri::AppHandle;

use super::model::{PromptInput, RunStatus, ScheduledPrompt};
use super::{now_secs, run, store, transcript};

/// Create or update a prompt from form input.
pub fn save(input: PromptInput) -> Result<ScheduledPrompt, String> {
    let now = now_secs();
    let existing = match &input.id {
        Some(id) => Some(store::prompt(id).ok_or("That scheduled prompt no longer exists.")?),
        None => None,
    };
    let prompt = input.build(existing.as_ref(), now)?;
    let saved = prompt.clone();
    store::update_prompts(
        move |list| match list.iter_mut().find(|p| p.id == prompt.id) {
            Some(slot) => *slot = prompt,
            None => list.push(prompt),
        },
    )?;
    Ok(saved)
}

/// Pause or resume. Resuming schedules from now — firings missed while paused
/// don't run.
pub fn set_enabled(id: &str, enabled: bool) -> Result<ScheduledPrompt, String> {
    let now = now_secs();
    store::update_prompts(|list| {
        let p = list.iter_mut().find(|p| p.id == id)?;
        p.enabled = enabled;
        p.next_run_at = if enabled {
            p.schedule.next_after(now, p.anchor_at)
        } else {
            None
        };
        Some(p.clone())
    })?
    .ok_or_else(|| "That scheduled prompt no longer exists.".to_string())
}

/// Delete a prompt with everything it owns: a live run, run history,
/// transcripts, and its worktree (unless a continued session still uses it).
pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    if let Some(ws) = run::live_workspace_for(app, id) {
        run::finish(app, &ws, RunStatus::Stopped, None);
    }
    store::update_prompts(|list| list.retain(|p| p.id != id))?;
    let removed = store::update_runs(|runs| {
        let removed: Vec<String> = runs
            .iter()
            .filter(|r| r.prompt_id == id)
            .map(|r| r.id.clone())
            .collect();
        runs.retain(|r| r.prompt_id != id);
        removed
    })?;
    for run_id in removed {
        transcript::delete(&run_id);
    }
    crate::commands::worktrees::remove_for_workspace(id);
    Ok(())
}
