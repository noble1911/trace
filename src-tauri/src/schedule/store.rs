//! Persistence for scheduled prompts and runs: two `0600` JSON files in the
//! config dir. The runner thread, commands and a second trace all write, so every
//! load→mutate→save goes through `update_*`, serialized by `persist`'s per-file lock.
//! The two locks are never held at the same time.

use std::path::PathBuf;

use super::model::{RunStatus, ScheduleRun, ScheduledPrompt};
use crate::helpers::persist::{self, Style};
use crate::helpers::trace_dir;

/// Runs kept per prompt. Older ones — and their transcripts — are pruned.
const RUNS_PER_PROMPT: usize = 30;

/// Skipped runs (the precheck said no) kept per prompt, on top of the real ones.
const SKIPPED_PER_PROMPT: usize = 10;

fn prompts_file() -> PathBuf {
    trace_dir().join("schedules.json")
}

fn runs_file() -> PathBuf {
    trace_dir().join("schedule-runs.json")
}

/// Every scheduled prompt, in creation order. A read failure is logged and reads as
/// none; anything that would act on "there are none" uses [`try_prompts`].
pub fn prompts() -> Vec<ScheduledPrompt> {
    persist::read_or_log(&prompts_file())
}

/// [`prompts`], with a read failure as an error.
pub fn try_prompts() -> Result<Vec<ScheduledPrompt>, String> {
    persist::read_or_default(&prompts_file())
}

pub fn prompt(id: &str) -> Option<ScheduledPrompt> {
    prompts().into_iter().find(|p| p.id == id)
}

/// Load, mutate and save the prompt list atomically (w.r.t. other writers).
pub fn update_prompts<R>(f: impl FnOnce(&mut Vec<ScheduledPrompt>) -> R) -> Result<R, String> {
    persist::update(&prompts_file(), Style::Compact, f)
}

/// Every run record, oldest first. A read failure is logged and reads as none.
pub fn runs() -> Vec<ScheduleRun> {
    persist::read_or_log(&runs_file())
}

/// [`runs`], with a read failure as an error.
pub fn try_runs() -> Result<Vec<ScheduleRun>, String> {
    persist::read_or_default(&runs_file())
}

/// Load, mutate and save the run list atomically (w.r.t. other writers).
pub fn update_runs<R>(f: impl FnOnce(&mut Vec<ScheduleRun>) -> R) -> Result<R, String> {
    persist::update(&runs_file(), Style::Compact, f)
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

/// When `prompt_id` last really ran, leaving out `except` (the run asking): a run
/// that ended at its precheck (skipped, timed out, stopped) had no agent look at
/// anything, so it doesn't count. Feeds `{lastRunAt}` and the precheck's
/// `TRACE_LAST_RUN_AT`.
pub fn last_run_at(prompt_id: &str, except: &str) -> Option<i64> {
    runs()
        .into_iter()
        .filter(|r| r.prompt_id == prompt_id && r.id != except)
        .filter(|r| !ended_at_precheck(r))
        .map(|r| r.started_at)
        .max()
}

/// The run never got past its precheck.
fn ended_at_precheck(run: &ScheduleRun) -> bool {
    run.status == RunStatus::Skipped
        || run
            .precheck
            .as_ref()
            .is_some_and(|p| p.exit_code != Some(0))
}

/// Record a new run, pruning its prompt's oldest finished runs past the cap.
/// Skipped runs have a cap of their own, so a precheck that skips every few
/// minutes can't push the real runs out of the history.
pub fn push_run(run: ScheduleRun) -> Result<(), String> {
    let prompt_id = run.prompt_id.clone();
    let pruned = update_runs(|runs| {
        runs.push(run);
        let doomed = prunable(runs, &prompt_id);
        runs.retain(|r| !doomed.contains(&r.id));
        doomed
    })?;
    for id in pruned {
        super::transcript::delete(&id);
    }
    Ok(())
}

/// Ids of `prompt_id`'s finished runs past the caps, oldest first (`runs` is
/// oldest-first). A run still going isn't counted: it may yet be skipped, and
/// counting it as a real one would push a real run out for a skip.
fn prunable(runs: &[ScheduleRun], prompt_id: &str) -> Vec<String> {
    let mine = runs
        .iter()
        .filter(|r| r.prompt_id == prompt_id && r.status != RunStatus::Running);
    let (skipped, kept): (Vec<&ScheduleRun>, Vec<&ScheduleRun>) =
        mine.partition(|r| r.status == RunStatus::Skipped);
    let mut doomed = oldest(&kept, RUNS_PER_PROMPT);
    doomed.extend(oldest(&skipped, SKIPPED_PER_PROMPT));
    doomed
}

/// The oldest runs that take `runs` past `cap`.
fn oldest(runs: &[&ScheduleRun], cap: usize) -> Vec<String> {
    let excess = runs.len().saturating_sub(cap);
    runs.iter().take(excess).map(|r| r.id.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schedule::model::Trigger;

    fn run(id: usize, status: RunStatus) -> ScheduleRun {
        ScheduleRun {
            id: id.to_string(),
            prompt_id: "p".to_string(),
            trigger: Trigger::Schedule,
            transport: Default::default(),
            status,
            started_at: id as i64,
            ended_at: None,
            prompt: String::new(),
            claude_session_id: None,
            needs_input: false,
            skipped: 0,
            background_tasks: 0,
            wakes_at: None,
            summary: String::new(),
            error: None,
            has_transcript: false,
            precheck: None,
        }
    }

    #[test]
    fn skipped_runs_are_capped_apart_from_real_ones() {
        let mut runs: Vec<ScheduleRun> = (0..RUNS_PER_PROMPT)
            .map(|i| run(i, RunStatus::Succeeded))
            .collect();
        let base = runs.len();
        runs.extend((0..SKIPPED_PER_PROMPT + 3).map(|i| run(base + i, RunStatus::Skipped)));
        let doomed = prunable(&runs, "p");
        // No real run goes; the three oldest skips do.
        let expected: Vec<String> = (base..base + 3).map(|i| i.to_string()).collect();
        assert_eq!(doomed, expected);

        runs.push(run(999, RunStatus::Failed));
        assert!(prunable(&runs, "p").contains(&"0".to_string()));
    }

    #[test]
    fn a_running_run_neither_goes_nor_pushes_a_real_one_out() {
        let mut runs = vec![run(0, RunStatus::Running)];
        runs.extend((1..=RUNS_PER_PROMPT).map(|i| run(i, RunStatus::Succeeded)));
        assert!(prunable(&runs, "p").is_empty());
        runs.push(run(99, RunStatus::Succeeded));
        assert_eq!(prunable(&runs, "p"), vec!["1".to_string()]);
    }

    #[test]
    fn runs_that_ended_at_their_precheck_are_not_the_last_run() {
        let mut timed_out = run(5, RunStatus::Failed);
        timed_out.precheck = Some(crate::schedule::precheck::PrecheckResult {
            command: "x".into(),
            exit_code: None,
            output: String::new(),
            timed_out: true,
            millis: 0,
        });
        assert!(ended_at_precheck(&timed_out));
        assert!(ended_at_precheck(&run(6, RunStatus::Skipped)));
        assert!(!ended_at_precheck(&run(7, RunStatus::Failed)));
    }
}
