//! Persistence for scheduled prompts and runs: two `0600` JSON files in the
//! config dir. The runner thread and commands write concurrently, so every
//! load→mutate→save goes through `update_*`, serialized by a per-file lock. The
//! two locks are never held at the same time.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::de::DeserializeOwned;
use serde::Serialize;

use super::model::{RunStatus, ScheduleRun, ScheduledPrompt};
use crate::helpers::{restrict_perms, trace_dir};

static PROMPTS_LOCK: Mutex<()> = Mutex::new(());
static RUNS_LOCK: Mutex<()> = Mutex::new(());

/// Runs kept per prompt. Older ones — and their transcripts — are pruned.
const RUNS_PER_PROMPT: usize = 30;

fn prompts_file() -> PathBuf {
    trace_dir().join("schedules.json")
}

fn runs_file() -> PathBuf {
    trace_dir().join("schedule-runs.json")
}

fn lock(m: &'static Mutex<()>) -> MutexGuard<'static, ()> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn read<T: DeserializeOwned + Default>(path: PathBuf) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write<T: Serialize>(path: PathBuf, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    restrict_perms(&path);
    Ok(())
}

/// Every scheduled prompt, in creation order.
pub fn prompts() -> Vec<ScheduledPrompt> {
    let _guard = lock(&PROMPTS_LOCK);
    read(prompts_file())
}

pub fn prompt(id: &str) -> Option<ScheduledPrompt> {
    prompts().into_iter().find(|p| p.id == id)
}

/// Load, mutate and save the prompt list atomically (w.r.t. other writers).
pub fn update_prompts<R>(f: impl FnOnce(&mut Vec<ScheduledPrompt>) -> R) -> Result<R, String> {
    let _guard = lock(&PROMPTS_LOCK);
    let mut list: Vec<ScheduledPrompt> = read(prompts_file());
    let result = f(&mut list);
    write(prompts_file(), &list)?;
    Ok(result)
}

/// Every run record, oldest first.
pub fn runs() -> Vec<ScheduleRun> {
    let _guard = lock(&RUNS_LOCK);
    read(runs_file())
}

/// Load, mutate and save the run list atomically (w.r.t. other writers).
pub fn update_runs<R>(f: impl FnOnce(&mut Vec<ScheduleRun>) -> R) -> Result<R, String> {
    let _guard = lock(&RUNS_LOCK);
    let mut list: Vec<ScheduleRun> = read(runs_file());
    let result = f(&mut list);
    write(runs_file(), &list)?;
    Ok(result)
}

/// Mutate one run; returns its updated copy (`None` if it no longer exists).
pub fn update_run(
    run_id: &str,
    f: impl FnOnce(&mut ScheduleRun),
) -> Result<Option<ScheduleRun>, String> {
    update_runs(|runs| {
        runs.iter_mut().find(|r| r.id == run_id).map(|r| {
            f(r);
            r.clone()
        })
    })
}

/// Record a new run, pruning its prompt's oldest finished runs past the cap.
pub fn push_run(run: ScheduleRun) -> Result<(), String> {
    let prompt_id = run.prompt_id.clone();
    let pruned = update_runs(|runs| {
        runs.push(run);
        let finished: Vec<String> = runs
            .iter()
            .filter(|r| r.prompt_id == prompt_id && r.status != RunStatus::Running)
            .map(|r| r.id.clone())
            .collect();
        let excess = runs.iter().filter(|r| r.prompt_id == prompt_id).count();
        let excess = excess.saturating_sub(RUNS_PER_PROMPT);
        // `runs` is oldest-first, so the first finished ids are the oldest.
        let doomed: Vec<String> = finished.into_iter().take(excess).collect();
        runs.retain(|r| !doomed.contains(&r.id));
        doomed
    })?;
    for id in pruned {
        super::transcript::delete(&id);
    }
    Ok(())
}
