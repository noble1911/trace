//! Background tasks that aren't subagents (shells, monitors, workflows), from
//! `system` `task_*` lines shaped as Claude 2.1.328 sends them.

use serde_json::{json, Value};

use super::replay::Run;
use crate::agent_session::claude::translate::Translator;
use crate::agent_session::{BackgroundTask, TaskKind};

fn run() -> (Translator, Run) {
    (Translator::new(0, || 1_000), Run::default())
}

fn feed(tr: &mut Translator, run: &mut Run, line: Value) -> Vec<Value> {
    run.take(tr.line(&line.to_string()))
}

fn started(task: &str, task_type: &str, call: &str, background: bool) -> Value {
    json!({"type": "system", "subtype": "task_started", "task_id": task,
           "tool_use_id": call, "description": format!("{task} job"),
           "task_type": task_type, "is_backgrounded": background})
}

fn notified(task: &str, status: &str) -> Value {
    json!({"type": "system", "subtype": "task_notification", "task_id": task,
           "status": status, "summary": "done"})
}

fn result() -> Value {
    json!({"type": "result", "subtype": "success", "is_error": false,
           "duration_ms": 10, "total_cost_usd": 0.0})
}

fn listed(run: &Run) -> Vec<(&str, TaskKind)> {
    run.info
        .background
        .iter()
        .map(|t| (t.task_id.as_str(), t.kind))
        .collect()
}

#[test]
fn a_background_shell_is_listed_until_it_ends_without_keeping_the_agent_at_work() {
    let (mut tr, mut run) = run();
    feed(
        &mut tr,
        &mut run,
        started("b1", "local_bash", "call1", true),
    );
    assert_eq!(
        run.info.background,
        vec![BackgroundTask {
            task_id: "b1".into(),
            kind: TaskKind::Shell,
            description: "b1 job".into(),
            started_at: 1_000,
            call_id: Some("call1".into()),
        }]
    );
    // A dev server can run all day: the agent is ready, not working.
    assert_eq!(run.info.running_subagents, 0);
    feed(&mut tr, &mut run, notified("b1", "completed"));
    assert!(run.info.background.is_empty());
}

#[test]
fn a_foreground_shell_shows_only_once_its_turn_ends_without_it() {
    let (mut tr, mut run) = run();
    feed(
        &mut tr,
        &mut run,
        started("b1", "local_bash", "call1", false),
    );
    assert!(listed(&run).is_empty(), "its Bash card is still running");
    feed(&mut tr, &mut run, result());
    assert_eq!(listed(&run), vec![("b1", TaskKind::Shell)]);
}

#[test]
fn a_task_backgrounded_later_shows_and_an_ending_update_removes_it() {
    let (mut tr, mut run) = run();
    feed(
        &mut tr,
        &mut run,
        started("b1", "local_bash", "call1", false),
    );
    let patch = |p: Value| json!({"type": "system", "subtype": "task_updated", "task_id": "b1", "patch": p});
    feed(&mut tr, &mut run, patch(json!({"is_backgrounded": true})));
    assert_eq!(listed(&run), vec![("b1", TaskKind::Shell)]);
    feed(&mut tr, &mut run, patch(json!({"status": "killed"})));
    assert!(listed(&run).is_empty());
}

#[test]
fn a_workflow_keeps_the_agent_at_work_and_its_own_agents_stay_inside_it() {
    let (mut tr, mut run) = run();
    feed(
        &mut tr,
        &mut run,
        started("w1", "local_workflow", "call1", true),
    );
    let mut child = started("a1", "local_agent", "call2", true);
    child["parent_task_id"] = json!("w1");
    feed(&mut tr, &mut run, child);
    feed(
        &mut tr,
        &mut run,
        started("m1", "monitor_mcp", "call3", true),
    );
    assert_eq!(
        listed(&run),
        vec![("m1", TaskKind::Monitor), ("w1", TaskKind::Workflow)]
    );
    assert_eq!(
        run.info.running_subagents, 1,
        "the workflow, not the monitor"
    );
    feed(&mut tr, &mut run, notified("w1", "completed"));
    assert_eq!(run.info.running_subagents, 0);
}

#[test]
fn a_subagent_has_its_own_card_so_it_is_not_listed() {
    let (mut tr, mut run) = run();
    let call = json!({"type": "assistant", "message": {"id": "m1", "role": "assistant",
        "content": [{"type": "tool_use", "id": "call1", "name": "Agent",
                     "input": {"description": "look", "prompt": "p", "run_in_background": true}}]}});
    feed(&mut tr, &mut run, call);
    feed(
        &mut tr,
        &mut run,
        started("a1", "local_agent", "call1", true),
    );
    assert!(listed(&run).is_empty());
    assert_eq!(run.info.running_subagents, 1);
}

#[test]
fn a_task_stops_by_the_call_that_started_it() {
    let (mut tr, mut run) = run();
    feed(
        &mut tr,
        &mut run,
        started("b1", "local_bash", "call1", true),
    );
    let reply = tr.stop_subagent("call1").unwrap();
    assert_eq!(
        reply["request"],
        json!({"subtype": "stop_task", "task_id": "b1"})
    );
}

#[test]
fn tasks_go_with_claudes_process() {
    let (mut tr, mut run) = run();
    feed(
        &mut tr,
        &mut run,
        started("b1", "local_bash", "call1", true),
    );
    run.take(tr.exited(None));
    assert!(run.info.background.is_empty());
}
