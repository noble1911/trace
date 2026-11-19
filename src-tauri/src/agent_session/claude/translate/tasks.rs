//! Background tasks that aren't subagents: a shell left running
//! (`run_in_background`, or one that outlived its turn), a monitor, a workflow,
//! a remote agent or teammate. Claude reports them with the same `system`
//! `task_*` lines as a subagent (`task_type` says which), but once the call
//! that started one returns it has no row that changes, so without this a
//! running dev server or a workflow the agent "handed off to" was invisible.
//! They go out as `SessionInfo::background`, which the chat's fact strip lists.
//!
//! - `task_started` adds one, unless it belongs to another task (a workflow's
//!   own agents name a `parent_task_id`). A foreground one (a Bash call the
//!   turn is waiting on) is held back until it's backgrounded or its turn ends.
//! - `task_updated` with an ending `status`, or `task_notification`, removes it.
//! - Claude going away removes them all: they went with its process.

use serde_json::{json, Value};

use super::{Out, Translator};
use crate::agent_session::claude::prompts::str_at;
use crate::agent_session::{BackgroundTask, TaskKind};

/// A task while it runs.
pub(super) struct TaskRun {
    task: BackgroundTask,
    /// Listed: it's in the background, or its turn ended without it.
    shown: bool,
}

/// What `task_type` names, as the strip calls it.
fn kind_of(task_type: &str) -> TaskKind {
    match task_type {
        "local_bash" => TaskKind::Shell,
        "monitor_mcp" | "monitor_ws" => TaskKind::Monitor,
        "local_workflow" => TaskKind::Workflow,
        "local_agent" | "remote_agent" | "in_process_teammate" => TaskKind::Agent,
        _ => TaskKind::Other,
    }
}

/// Claude's `stop_task` for one task.
pub(super) fn stop_task(task_id: &str) -> Value {
    json!({
        "type": "control_request",
        "request_id": format!("stop-{task_id}"),
        "request": {"subtype": "stop_task", "task_id": task_id},
    })
}

impl Translator {
    /// A `task_*` line about a task that isn't one of the conversation's subagents.
    pub(super) fn other_task(&mut self, m: &Value, subtype: &str, out: &mut Vec<Out>) {
        let Some(id) = str_at(m, "task_id").map(str::to_string) else {
            return;
        };
        match subtype {
            "task_started" => {
                if m.get("parent_task_id").is_some_and(|p| !p.is_null()) {
                    return;
                }
                let description = str_at(m, "description")
                    .or_else(|| str_at(m, "workflow_name"))
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let task = BackgroundTask {
                    task_id: id.clone(),
                    kind: kind_of(str_at(m, "task_type").unwrap_or("")),
                    description,
                    started_at: self.book.now(),
                    call_id: str_at(m, "tool_use_id").map(str::to_string),
                };
                let shown = m["is_backgrounded"].as_bool() != Some(false);
                self.background.insert(id, TaskRun { task, shown });
            }
            "task_updated" => {
                let patch = &m["patch"];
                if let Some(run) = self.background.get_mut(&id) {
                    run.shown |= patch["is_backgrounded"].as_bool() == Some(true);
                }
                if matches!(
                    str_at(patch, "status"),
                    Some("completed" | "failed" | "killed" | "stopped")
                ) {
                    self.background.remove(&id);
                }
            }
            "task_notification" => {
                self.background.remove(&id);
            }
            _ => return,
        }
        self.publish_tasks(out);
    }

    /// A Task/Agent call turned out to start a subagent: it has its own card,
    /// so it isn't listed here too, whichever line came first.
    pub(super) fn not_a_task(&mut self, call_id: &str) {
        self.background
            .retain(|_, r| r.task.call_id.as_deref() != Some(call_id));
    }

    /// The turn ended: what it left running is in the background now.
    pub(super) fn tasks_outlive_turn(&mut self, out: &mut Vec<Out>) {
        let mut changed = false;
        for run in self.background.values_mut() {
            changed |= !run.shown;
            run.shown = true;
        }
        if changed {
            self.publish_tasks(out);
        }
    }

    /// Claude went away, and its tasks with it.
    pub(super) fn end_tasks(&mut self, out: &mut Vec<Out>) {
        if !self.background.is_empty() {
            self.background.clear();
            self.publish_tasks(out);
        }
    }

    /// The running task a call started, to stop it.
    pub(super) fn task_of_call(&self, call_id: &str) -> Option<&str> {
        self.background
            .values()
            .find(|r| r.task.call_id.as_deref() == Some(call_id))
            .map(|r| r.task.task_id.as_str())
    }

    /// Agents and workflows among the tasks: the agent is at work while one runs.
    pub(super) fn working_tasks(&self) -> u32 {
        self.background
            .values()
            .filter(|r| r.task.kind.is_work())
            .count() as u32
    }

    fn publish_tasks(&mut self, out: &mut Vec<Out>) {
        let mut shown: Vec<BackgroundTask> = self
            .background
            .values()
            .filter(|r| r.shown)
            .map(|r| r.task.clone())
            .collect();
        shown.sort_by(|a, b| (a.started_at, &a.task_id).cmp(&(b.started_at, &b.task_id)));
        self.set_info(out, |i| i.background = shown);
        self.count_subagents(out);
    }
}
