//! A turn's lifecycle: the user's message opens it (a user row and a running
//! turn row), Claude's `result` closes it, and an interrupt or the process
//! ending closes it early. Whatever was still open then is settled: streaming
//! text stops, unanswered prompts are cancelled, running tools fail.

use serde_json::{json, Value};

use super::{message, OpenTurn, Out, Translator};
use crate::agent_session::claude::prompts::{self, str_at};
use crate::agent_session::journal::{
    Answer, JournalBody, Resolution, Role, SubagentState, Tone, ToolState, Turn, TurnState, Usage,
};

impl Translator {
    /// The open turn's id, opening one if Claude started work without a message
    /// from us (a queued message, a resumed turn).
    pub(super) fn turn_id(&mut self, out: &mut Vec<Out>) -> String {
        if let Some(turn) = &self.turn {
            return turn.id.clone();
        }
        let id = format!("turn-{}", self.book.next_seq());
        let body = turn_body(&id, TurnState::Running, None, None);
        out.push(Out::Row(self.book.put(
            &format!("turn:{id}"),
            Some(&id),
            body,
        )));
        self.turn = Some(OpenTurn {
            id: id.clone(),
            interrupting: false,
        });
        self.set_info(out, |i| i.busy = true);
        id
    }

    /// A user turn: its row (the text, with its `attachments` drawn under it), and
    /// `content` as the stream-json line Claude reads. A message sent while a
    /// turn runs joins it; Claude queues it.
    pub fn send(&mut self, text: &str, attachments: &[String], content: Value) -> Vec<Out> {
        let mut out = Vec::new();
        let turn = self.turn_id(&mut out);
        let id = format!("user:{}", self.book.next_seq());
        let mut body = message(Role::User, text, false);
        if let JournalBody::Message(m) = &mut body {
            m.attachments = attachments.to_vec();
        }
        let row = self.book.put(&id, Some(&turn), body);
        out.push(Out::Row(row));
        self.book.retire(&id);
        out.push(Out::Reply(json!({
            "type": "user",
            "message": {"role": "user", "content": content},
        })));
        out
    }

    /// Answer an open approval or question.
    pub fn answer(&mut self, request_id: &str, answer: Answer) -> Result<Vec<Out>, String> {
        let pending = self
            .pending
            .remove(request_id)
            .ok_or("That prompt isn't open any more.")?;
        let trace_mode = crate::permissions::trace_decides(&self.workspace_id, true);
        let reply = match prompts::response(request_id, &pending, &answer, trace_mode) {
            Ok(reply) => reply,
            Err(e) => {
                self.pending.insert(request_id.to_string(), pending);
                return Err(e);
            }
        };
        // "Always allow" is trace's rule to keep, for the rest of this run.
        if trace_mode {
            if let Answer::Approval { option_id, .. } = &answer {
                if option_id.starts_with("always:") {
                    crate::permissions::grant(&self.workspace_id, pending.rule_for(option_id));
                }
            }
        }
        let mut out = vec![Out::Reply(reply)];
        self.resolve(&pending.row_id, Resolution::Answered { answer }, &mut out);
        Ok(out)
    }

    /// The stream-json request that stops the running turn. `None` with no turn.
    /// Claude's interrupt also stops every subagent, background ones too, so it's
    /// sent with no turn running while a subagent still works.
    pub fn interrupt(&mut self) -> Option<Value> {
        let subagents = self.running_subagents();
        let id = match self.turn.as_mut() {
            Some(turn) => {
                turn.interrupting = true;
                turn.id.clone()
            }
            None if subagents > 0 => format!("subagents-{}", self.book.next_seq()),
            None => return None,
        };
        Some(json!({
            "type": "control_request",
            "request_id": format!("interrupt-{id}"),
            "request": {"subtype": "interrupt"},
        }))
    }

    /// Claude's process ended. `reason` is set when nobody asked it to.
    pub fn exited(&mut self, reason: Option<&str>) -> Vec<Out> {
        let mut out = Vec::new();
        if self.turn.is_some() {
            let state = match (reason, self.turn.as_ref().is_some_and(|t| t.interrupting)) {
                (_, true) | (None, _) => TurnState::Interrupted,
                (Some(_), false) => TurnState::Failed,
            };
            self.end_turn(state, None, None, &mut out);
        }
        // Background subagents and tasks went with the process.
        self.end_subagents(SubagentState::Stopped, &mut out);
        self.end_tasks(&mut out);
        if let Some(reason) = reason {
            self.status(reason, Tone::Error, &mut out);
        }
        self.set_info(&mut out, |i| i.busy = false);
        out
    }

    pub(super) fn result(&mut self, m: &Value, out: &mut Vec<Out>) {
        // A result with no turn of ours still gets a turn row to carry its usage.
        self.turn_id(out);
        let interrupted = self.turn.as_ref().is_some_and(|t| t.interrupting)
            || str_at(m, "terminal_reason").is_some_and(|r| r.starts_with("aborted"));
        let failed = m["is_error"].as_bool().unwrap_or(false);
        let state = if interrupted {
            TurnState::Interrupted
        } else if failed {
            TurnState::Failed
        } else {
            TurnState::Completed
        };
        if state == TurnState::Failed {
            let text = str_at(m, "result")
                .filter(|r| !r.is_empty())
                .map(str::to_string)
                .or_else(|| {
                    let errors = m["errors"].as_array()?;
                    let all: Vec<&str> = errors.iter().filter_map(Value::as_str).collect();
                    (!all.is_empty()).then(|| all.join("\n"))
                })
                .unwrap_or_else(|| "The turn failed.".to_string());
            self.status(&text, Tone::Error, out);
        }
        let total = m["total_cost_usd"].as_f64();
        let cost = total.map(|t| (t - self.cost_so_far).max(0.0));
        if let Some(t) = total {
            self.cost_so_far = t;
        }
        let u = &m["usage"];
        let n = |k: &str| u[k].as_u64().unwrap_or(0);
        let usage = Usage {
            input_tokens: n("input_tokens"),
            output_tokens: n("output_tokens"),
            cache_read_tokens: n("cache_read_input_tokens"),
            cache_write_tokens: n("cache_creation_input_tokens"),
            cost_usd: cost,
        };
        self.end_turn(state, m["duration_ms"].as_u64(), Some(usage), out);
        self.context_from_result(m, out);
    }

    /// Close the open turn, settling what it left open.
    fn end_turn(
        &mut self,
        state: TurnState,
        duration_ms: Option<u64>,
        usage: Option<Usage>,
        out: &mut Vec<Out>,
    ) {
        let Some(turn) = self.turn.take() else {
            return;
        };
        for (_, block) in std::mem::take(&mut self.blocks) {
            if self.book.get(&block.row_id).is_some() {
                let body = message(block.role, &block.text, false);
                out.push(Out::Row(self.book.put(&block.row_id, None, body)));
                self.book.retire(&block.row_id);
            }
        }
        self.streamed.clear();
        let open: Vec<String> = self.pending.keys().cloned().collect();
        for request_id in open {
            self.cancel_prompt(&request_id, out);
        }
        // A finished turn can leave a background tool running; one cut short can't.
        // Claude's interrupt stops every subagent, background ones too.
        if state != TurnState::Completed {
            self.end_subagents(SubagentState::Stopped, out);
            let running = self
                .book
                .open_ids(|b| matches!(b, JournalBody::Tool(t) if t.state == ToolState::Running));
            for id in running {
                let row = self.book.update(&id, |body| {
                    if let JournalBody::Tool(t) = body {
                        t.state = ToolState::Failed;
                        t.output.get_or_insert_with(|| "Interrupted.".to_string());
                    }
                });
                out.extend(row.map(Out::Row));
                self.book.retire(&id);
                if let Some(call) = id.strip_prefix("tool:") {
                    self.tools.remove(call);
                }
            }
        }
        self.tasks_outlive_turn(out);
        let plan = format!("plan:{}", turn.id);
        self.book.retire(&plan);
        let id = format!("turn:{}", turn.id);
        let body = turn_body(&turn.id, state, duration_ms, usage);
        out.push(Out::Row(self.book.put(&id, Some(&turn.id), body)));
        self.book.retire(&id);
        self.set_info(out, |i| i.busy = false);
    }

    /// Claude withdrew a prompt (or its turn ended unanswered).
    pub(super) fn cancel_prompt(&mut self, request_id: &str, out: &mut Vec<Out>) {
        if let Some(pending) = self.pending.remove(request_id) {
            self.resolve(&pending.row_id, Resolution::Cancelled, out);
        }
    }

    fn resolve(&mut self, row_id: &str, resolution: Resolution, out: &mut Vec<Out>) {
        let row = self.book.update(row_id, |body| match body {
            JournalBody::Approval(a) => a.resolution = Some(resolution),
            JournalBody::Question(q) => q.resolution = Some(resolution),
            _ => {}
        });
        out.extend(row.map(Out::Row));
        self.book.retire(row_id);
    }
}

fn turn_body(
    id: &str,
    state: TurnState,
    duration_ms: Option<u64>,
    usage: Option<Usage>,
) -> JournalBody {
    JournalBody::Turn(Turn {
        turn_id: id.to_string(),
        state,
        duration_ms,
        usage,
    })
}
