//! Scheduled runs on the activity log: started, finished, failed, and blocked on
//! a human. Logged per run (not per turn) — a run's turns are its own business.

use serde_json::json;
use tauri::AppHandle;

use super::model::{RunStatus, ScheduleRun, Trigger};
use super::{run_workspace_id, store};
use crate::activity::{clip, record, ActivityInput, ActivityKind, Actor};

/// Log a run that just started or reached a final status. A user stop isn't
/// logged — they know.
pub fn log_run(app: &AppHandle, run: &ScheduleRun) {
    let (kind, title) = match run.status {
        RunStatus::Running => (ActivityKind::ScheduleRunStarted, "run started"),
        RunStatus::Succeeded => (ActivityKind::ScheduleRunSucceeded, "run finished"),
        RunStatus::Failed => (ActivityKind::ScheduleRunFailed, "run failed"),
        RunStatus::TimedOut => (ActivityKind::ScheduleRunFailed, "run timed out"),
        RunStatus::Stopped => return,
    };
    let actor = match (run.trigger, run.status) {
        (Trigger::Schedule, RunStatus::Running) => Actor::Schedule,
        (_, RunStatus::Running) => Actor::User,
        _ => Actor::Schedule,
    };
    let data = json!({
        "promptId": run.prompt_id,
        "runId": run.id,
        "summary": (!run.summary.is_empty()).then(|| clip(&run.summary, 400)),
        "error": run.error.as_deref().map(|e| clip(e, 200)),
    });
    record(app, input(run, kind, actor, title, data));
}

/// Log a run that's blocked on a human (a permission prompt, usually).
pub fn log_needs_input(app: &AppHandle, run: &ScheduleRun) {
    let data = json!({ "promptId": run.prompt_id, "runId": run.id });
    let kind = ActivityKind::AgentNeedsInput;
    record(app, input(run, kind, Actor::Agent, "needs your input", data));
}

fn input(
    run: &ScheduleRun,
    kind: ActivityKind,
    actor: Actor,
    title: &str,
    data: serde_json::Value,
) -> ActivityInput {
    let name = store::prompt(&run.prompt_id).map_or_else(|| "a schedule".into(), |p| p.title);
    ActivityInput {
        workspace_id: Some(run_workspace_id(&run.id)),
        subject: Some(format!("⏱ {name}")),
        data,
        ..ActivityInput::new(kind, actor, title)
    }
}
