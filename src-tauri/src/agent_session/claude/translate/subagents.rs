//! Subagents (Task/Agent calls). The call's row carries a `Subagent` that
//! Claude's `system` `task_*` lines keep current; the subagent's own text,
//! thinking and calls are rows with `parentCallId` (the `assistant` lines with
//! `parent_tool_use_id`), filed under the turn that started it so a background
//! one never opens a turn of its own. Recorded: `fixtures/subagents.jsonl`,
//! `background_subagent.jsonl`, `subagent_interrupt.jsonl`.
//!
//! - `task_started` names the task (for `stop_task`) and says whether it's in
//!   the background; `task_progress` gives its activity, tool count and time;
//!   `task_notification` ends it: completed (with its report), failed, stopped.
//! - The call's own `tool_result` can come before or after that end (and comes
//!   at once for a background agent), so the row stays open until both have.

use serde_json::Value;

use super::{Out, Translator};
use crate::agent_session::claude::handback;
use crate::agent_session::claude::prompts::str_at;
use crate::agent_session::journal::{cap, JournalBody, Subagent, SubagentState, ToolState};

/// What the translator keeps about a subagent while its row is open.
pub(super) struct SubRun {
    /// The turn its rows are filed under.
    pub turn: String,
    /// Claude's task id, for `stop_task`. None until `task_started`.
    pub task_id: Option<String>,
    pub running: bool,
    /// Its call's `tool_result` came.
    pub call_done: bool,
    /// Its `task_notification` came (or no task events will: none started).
    pub task_done: bool,
}

/// A Task/Agent call's subagent, from its input, before Claude says more.
pub(super) fn subagent_of(name: &str, input: &Value) -> Option<Subagent> {
    if !matches!(name, "Task" | "Agent") {
        return None;
    }
    let text = |k: &str| str_at(input, k).map(str::to_string);
    let background = input["run_in_background"].as_bool().unwrap_or(false);
    Some(Subagent::running(
        text("subagent_type"),
        text("description"),
        background,
    ))
}

impl Translator {
    /// The turn a row belongs to: its subagent's, else the open one.
    pub(super) fn row_turn(&mut self, parent: Option<&str>, out: &mut Vec<Out>) -> String {
        if let Some(run) = parent.and_then(|p| self.subagents.get(p)) {
            return run.turn.clone();
        }
        self.turn_id(out)
    }

    pub(super) fn started_subagent(&mut self, call_id: &str, turn: &str, out: &mut Vec<Out>) {
        let run = SubRun {
            turn: turn.to_string(),
            task_id: None,
            running: true,
            call_done: false,
            task_done: false,
        };
        self.subagents.insert(call_id.to_string(), run);
        self.not_a_task(call_id);
        self.count_subagents(out);
    }

    /// `system` `task_*` lines about a subagent.
    pub(super) fn task_event(&mut self, m: &Value, subtype: &str, out: &mut Vec<Out>) {
        let call = str_at(m, "tool_use_id").map(str::to_string).or_else(|| {
            str_at(m, "task_id")
                .and_then(|t| self.tasks.get(t))
                .cloned()
        });
        // Background shells, monitors and workflows report as tasks too (`tasks`).
        let Some(call) = call.filter(|c| self.subagents.contains_key(c)) else {
            self.other_task(m, subtype, out);
            return;
        };
        let usage = &m["usage"];
        let tool_uses = usage["tool_uses"].as_u64().map(|n| n as u32);
        let duration = usage["duration_ms"].as_u64();
        match subtype {
            "task_started" => {
                if let (Some(task), Some(run)) =
                    (str_at(m, "task_id"), self.subagents.get_mut(&call))
                {
                    run.task_id = Some(task.to_string());
                    self.tasks.insert(task.to_string(), call.clone());
                }
                let background = m["is_backgrounded"].as_bool().unwrap_or(false);
                let kind = str_at(m, "subagent_type").map(str::to_string);
                let about = str_at(m, "description").map(str::to_string);
                self.update_subagent(&call, out, |s| {
                    s.background |= background;
                    s.agent_type = s.agent_type.take().or(kind);
                    s.description = s.description.take().or(about);
                });
            }
            "task_progress" => {
                let activity = str_at(m, "description").map(str::to_string);
                self.update_subagent(&call, out, |s| {
                    s.activity = activity.or(s.activity.take());
                    s.tool_uses = tool_uses.or(s.tool_uses);
                    s.duration_ms = duration.or(s.duration_ms);
                });
            }
            "task_notification" => {
                let state = match str_at(m, "status") {
                    Some("completed") => SubagentState::Completed,
                    Some("failed") => SubagentState::Failed,
                    _ => SubagentState::Stopped,
                };
                // A stopped task's "summary" is only its description again.
                let report = (state != SubagentState::Stopped)
                    .then(|| str_at(m, "summary").map(handback::unwrap))
                    .flatten()
                    .filter(|s| !s.is_empty())
                    .map(|s| cap(&s));
                self.update_subagent(&call, out, |s| {
                    s.state = state;
                    s.result = report.or(s.result.take());
                    s.tool_uses = tool_uses.or(s.tool_uses);
                    s.duration_ms = duration.or(s.duration_ms);
                });
                if let Some(run) = self.subagents.get_mut(&call) {
                    run.running = false;
                    run.task_done = true;
                }
                self.end_children(&call, out);
                self.maybe_close_subagent(&call);
                self.count_subagents(out);
            }
            _ => {}
        }
    }

    /// The Task/Agent call's own result. Foreground: the subagent is done
    /// (`detail`, the line's `tool_use_result`, has its report and totals).
    /// Background: it was only launched.
    pub(super) fn subagent_call_done(
        &mut self,
        call: &str,
        failed: bool,
        detail: Option<&Value>,
        out: &mut Vec<Out>,
    ) {
        let launched = detail.and_then(|d| str_at(d, "status")) == Some("async_launched");
        let report = detail.and_then(|d| report_text(&d["content"]));
        let totals = detail.map(|d| {
            (
                d["totalToolUseCount"].as_u64().map(|n| n as u32),
                d["totalDurationMs"].as_u64(),
            )
        });
        let (tool_uses, duration) = totals.unwrap_or((None, None));
        let has_task = self
            .subagents
            .get(call)
            .is_some_and(|r| r.task_id.is_some());
        let mut ended = false;
        self.update_subagent(call, out, |s| {
            if launched {
                s.background = true;
                return;
            }
            s.tool_uses = tool_uses.or(s.tool_uses);
            s.duration_ms = duration.or(s.duration_ms);
            if s.result.is_none() && !failed {
                s.result = report;
            }
            // The task's own end (if it reports one) has the last word.
            if s.is_running() {
                s.state = if failed {
                    SubagentState::Failed
                } else {
                    SubagentState::Completed
                };
                ended = !has_task;
            }
        });
        if let Some(run) = self.subagents.get_mut(call) {
            run.call_done = true;
            if ended || (!launched && !has_task) {
                run.running = false;
                run.task_done = true;
            }
        }
        self.maybe_close_subagent(call);
        self.count_subagents(out);
    }

    /// `stop_task` for one subagent, or for the background task a call started
    /// (a shell, a monitor: `tasks`).
    pub fn stop_subagent(&mut self, call_id: &str) -> Result<Value, String> {
        if let Some(task) = self.task_of_call(call_id) {
            return Ok(super::tasks::stop_task(task));
        }
        let run = self
            .subagents
            .get(call_id)
            .filter(|r| r.running)
            .ok_or("That subagent isn't running.")?;
        let task = run
            .task_id
            .as_deref()
            .ok_or("Claude hasn't named that subagent's task yet.")?;
        Ok(super::tasks::stop_task(task))
    }

    /// Subagents still working, and agents or workflows among the other tasks.
    pub(super) fn running_subagents(&self) -> u32 {
        self.subagents.values().filter(|r| r.running).count() as u32 + self.working_tasks()
    }

    pub(super) fn count_subagents(&mut self, out: &mut Vec<Out>) {
        let n = self.running_subagents();
        self.set_info(out, |i| i.running_subagents = n);
    }

    /// Every subagent still running ends as `state` (the turn was cut short, or
    /// Claude went away): its open calls fail and its row closes.
    pub(super) fn end_subagents(&mut self, state: SubagentState, out: &mut Vec<Out>) {
        let running: Vec<String> = self
            .subagents
            .iter()
            .filter(|(_, r)| r.running)
            .map(|(c, _)| c.clone())
            .collect();
        for call in running {
            self.tools.remove(&call);
            let row = self.book.update(&format!("tool:{call}"), |body| {
                if let JournalBody::Tool(t) = body {
                    if t.state == ToolState::Running {
                        t.state = ToolState::Failed;
                        t.output.get_or_insert_with(|| "Interrupted.".to_string());
                    }
                    if let Some(s) = t.subagent.as_mut().filter(|s| s.is_running()) {
                        s.state = state;
                    }
                }
            });
            out.extend(row.map(Out::Row));
            if let Some(run) = self.subagents.get_mut(&call) {
                run.running = false;
                run.task_done = true;
                run.call_done = true;
            }
            self.end_children(&call, out);
            self.maybe_close_subagent(&call);
        }
        self.count_subagents(out);
    }

    fn update_subagent(&mut self, call: &str, out: &mut Vec<Out>, f: impl FnOnce(&mut Subagent)) {
        let row = self.book.update(&format!("tool:{call}"), |body| {
            if let JournalBody::Tool(t) = body {
                if let Some(s) = t.subagent.as_mut() {
                    f(s);
                }
            }
        });
        out.extend(row.map(Out::Row));
    }

    /// Close the call's row once nothing more will change it.
    fn maybe_close_subagent(&mut self, call: &str) {
        if self
            .subagents
            .get(call)
            .is_some_and(|r| r.call_done && r.task_done)
        {
            self.book.retire(&format!("tool:{call}"));
        }
    }

    /// A subagent that ended leaves no call of its own running.
    fn end_children(&mut self, call: &str, out: &mut Vec<Out>) {
        let children: Vec<String> = self
            .tools
            .iter()
            .filter(|(_, c)| c.parent.as_deref() == Some(call))
            .map(|(id, _)| id.clone())
            .collect();
        for child in children {
            self.tools.remove(&child);
            let id = format!("tool:{child}");
            let row = self.book.update(&id, |body| {
                if let JournalBody::Tool(t) = body {
                    if t.state == ToolState::Running {
                        t.state = ToolState::Failed;
                        t.output.get_or_insert_with(|| "Stopped.".to_string());
                    }
                }
            });
            out.extend(row.map(Out::Row));
            self.book.retire(&id);
        }
    }
}

/// A subagent's report from its call's `tool_use_result.content`: the text
/// blocks, less Claude's note of the tools it used.
fn report_text(content: &Value) -> Option<String> {
    let parts: Vec<&str> = content
        .as_array()?
        .iter()
        .filter_map(|b| str_at(b, "text"))
        .filter(|t| !t.trim_start().starts_with("<tools-used"))
        .collect();
    let text = parts.join("\n").trim().to_string();
    (!text.is_empty()).then(|| cap(&text))
}
