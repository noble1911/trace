//! Claude's stream-json output, line by line, as journal rows. Pure: no process,
//! no IO, so the fixture test drives it with recorded lines. What the adapter must
//! write back to Claude comes out as `Out::Reply`.
//!
//! - `stream_event` partial text and thinking → streaming message rows, keyed by
//!   the API message id and block index; the final `assistant` line's copy of the
//!   same text is then skipped.
//! - `assistant` `tool_use` → a tool row (TodoWrite → a plan row instead), which
//!   the matching `user` `tool_result` completes or fails; a successful Edit,
//!   MultiEdit or Write adds a diff row.
//! - `control_request` `can_use_tool` → an approval or question row (`prompts`).
//! - `result` → the turn row, with usage and cost; `system`/`rate_limit_event` →
//!   `SessionInfo`. See `turn` for the turn's lifecycle. Usage also fills the
//!   context gauge (`context`).
//! - Task/Agent calls and `system` `task_*` lines → a subagent on the call's
//!   row, its own rows carrying `parentCallId` (`subagents`); other background
//!   tasks (shells, monitors, workflows) → `SessionInfo::background` (`tasks`).

mod context;
mod options;
mod session;
mod subagents;
mod tasks;
mod turn;

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::book::RowBook;
use super::handback;
use super::prompts::{self, str_at, Pending};
use super::tools;
use crate::agent_session::journal::{
    JournalBody, JournalRow, Message, Role, Status, Tone, ToolCall, ToolState,
};
use crate::agent_session::SessionInfo;

/// What a line (or a user action) produced.
#[derive(Debug, PartialEq)]
pub enum Out {
    Row(JournalRow),
    Info(SessionInfo),
    /// A line to write to Claude's stdin.
    Reply(Value),
    /// A message for trace's SDK MCP server, answered as a `control_response`
    /// to `request_id` once its tool has run (`mcp_reply`).
    Mcp {
        request_id: String,
        message: Value,
    },
}

/// The SDK MCP server trace declares at `initialize` (`claude::mod`).
pub const TOOLS_SERVER: &str = "trace";

/// The `control_response` carrying an SDK MCP server's JSON-RPC reply.
pub fn mcp_reply(request_id: &str, reply: Option<Value>) -> Value {
    // A notification has no reply; Claude still waits on the request.
    let reply = reply.unwrap_or_else(|| json!({ "jsonrpc": "2.0", "result": {}, "id": 0 }));
    json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request_id,
                      "response": { "mcp_response": reply } },
    })
}

/// One agent's translation state: the rows still open and what they wait on.
/// Owned by the adapter's thread, never shared.
pub struct Translator {
    /// Whose permission rules answer this agent's prompts. Empty until the adapter
    /// says (`decides_for`), and in tests, where nothing is decided for it.
    workspace_id: String,
    book: RowBook,
    info: SessionInfo,
    turn: Option<OpenTurn>,
    /// Text and thinking blocks still streaming, by (API message id, index).
    blocks: HashMap<(String, u64), Block>,
    /// API messages whose text came as stream events this turn.
    streamed: HashSet<String>,
    /// Tool calls awaiting their result, by call id.
    tools: HashMap<String, PendingCall>,
    /// Subagents by the call that started them.
    subagents: HashMap<String, subagents::SubRun>,
    /// Claude's task ids → the call that started each.
    tasks: HashMap<String, String>,
    /// Background tasks that aren't subagents, by Claude's task id.
    background: HashMap<String, tasks::TaskRun>,
    /// Prompts awaiting the user, by request id.
    pending: HashMap<String, Pending>,
    /// `total_cost_usd` so far: it's cumulative, a turn's cost is the difference.
    cost_so_far: f64,
    context: context::ContextState,
    /// Option changes sent, until Claude answers (`options`).
    options: options::OptionRequests,
}

struct PendingCall {
    name: String,
    /// The full input (the row's is capped).
    input: Value,
    /// The subagent that made it.
    parent: Option<String>,
}

struct OpenTurn {
    id: String,
    interrupting: bool,
}

struct Block {
    row_id: String,
    role: Role,
    text: String,
}

impl Translator {
    /// `next_seq` continues the journal; `clock` gives Unix milliseconds (fixed
    /// in tests).
    pub fn new(next_seq: u64, clock: fn() -> u64) -> Self {
        Self {
            workspace_id: String::new(),
            book: RowBook::new(next_seq, clock),
            info: SessionInfo {
                agent: "claude".to_string(),
                ..SessionInfo::default()
            },
            turn: None,
            blocks: HashMap::new(),
            streamed: HashSet::new(),
            tools: HashMap::new(),
            subagents: HashMap::new(),
            tasks: HashMap::new(),
            background: HashMap::new(),
            pending: HashMap::new(),
            cost_so_far: 0.0,
            context: context::ContextState::default(),
            options: options::OptionRequests::default(),
        }
    }

    /// One line of Claude's stdout. Lines that aren't JSON are ignored.
    pub fn line(&mut self, line: &str) -> Vec<Out> {
        let mut out = Vec::new();
        let Ok(m) = serde_json::from_str::<Value>(line) else {
            return out;
        };
        match str_at(&m, "type") {
            Some("stream_event") => self.stream_event(&m, &mut out),
            Some("assistant") => self.assistant(&m, &mut out),
            Some("user") => self.tool_results(&m, &mut out),
            Some("control_request") => self.control_request(&m, &mut out),
            Some("control_cancel_request") => {
                if let Some(id) = str_at(&m, "request_id") {
                    self.cancel_prompt(id, &mut out);
                }
            }
            Some("control_response") => self.control_response(&m, &mut out),
            Some("result") => self.result(&m, &mut out),
            Some("system") => self.system(&m, &mut out),
            Some("rate_limit_event") => self.rate_limits(&m["rate_limit_info"], &mut out),
            _ => {}
        }
        out
    }

    /// The row id for one block of one assistant message.
    ///
    /// Some builds send stream events with no message id anywhere on them. Left
    /// to `msg::{index}`, every message of the session shares one row id, and a
    /// row the book has retired starts its revisions at 0 again — which the
    /// renderer reads as a stale copy of the first message and drops, so the
    /// agent answers and the conversation shows nothing. A row's own place in
    /// the journal is unique, so name it by that when the message isn't named.
    fn block_id(&self, message_id: &str, index: u64) -> String {
        if message_id.is_empty() {
            format!("msg:s{}:{index}", self.book.next_seq())
        } else {
            format!("msg:{message_id}:{index}")
        }
    }

    fn stream_event(&mut self, m: &Value, out: &mut Vec<Out>) {
        // A subagent's text is its own business; its tool calls still show.
        if !m["parent_tool_use_id"].is_null() {
            return;
        }
        let e = &m["event"];
        let mid = str_at(m, "api_message_id")
            .or_else(|| str_at(&e["message"], "id"))
            .unwrap_or_default()
            .to_string();
        let index = e["index"].as_u64().unwrap_or(0);
        match str_at(e, "type") {
            Some("message_start") => {
                self.streamed.insert(mid);
            }
            Some("content_block_start") => {
                let role = match str_at(&e["content_block"], "type") {
                    Some("text") => Role::Assistant,
                    Some("thinking") => Role::Reasoning,
                    _ => return,
                };
                let row_id = self.block_id(&mid, index);
                let text = String::new();
                self.blocks
                    .insert((mid, index), Block { row_id, role, text });
            }
            Some("content_block_delta") => {
                let d = &e["delta"];
                let piece = str_at(d, "text").or_else(|| str_at(d, "thinking"));
                let Some(piece) = piece.filter(|p| !p.is_empty()) else {
                    return;
                };
                let turn = self.turn_id(out);
                if let Some(block) = self.blocks.get_mut(&(mid, index)) {
                    block.text.push_str(piece);
                    let body = message(block.role, &block.text, true);
                    out.push(Out::Row(self.book.put(&block.row_id, Some(&turn), body)));
                }
            }
            Some("content_block_stop") => {
                let Some(block) = self.blocks.remove(&(mid, index)) else {
                    return;
                };
                if self.book.get(&block.row_id).is_some() {
                    let body = message(block.role, &block.text, false);
                    out.push(Out::Row(self.book.put(&block.row_id, None, body)));
                    self.book.retire(&block.row_id);
                }
            }
            _ => {}
        }
    }

    fn assistant(&mut self, m: &Value, out: &mut Vec<Out>) {
        let msg = &m["message"];
        let mid = str_at(msg, "id").unwrap_or_default();
        let parent = str_at(m, "parent_tool_use_id").map(str::to_string);
        let uuid = str_at(m, "uuid").unwrap_or(mid).to_string();
        // A subagent's text never streams: its `assistant` lines are the only copy.
        let streamed = self.streamed.contains(mid);
        let blocks = msg["content"].as_array().cloned().unwrap_or_default();
        self.context_from_assistant(m, out);
        for (i, block) in blocks.iter().enumerate() {
            let turn = self.row_turn(parent.as_deref(), out);
            match str_at(block, "type") {
                Some(kind @ ("text" | "thinking")) if !streamed => {
                    let text = str_at(block, kind).unwrap_or_default();
                    if text.is_empty() {
                        continue;
                    }
                    let role = if kind == "text" {
                        Role::Assistant
                    } else {
                        Role::Reasoning
                    };
                    let id = self.block_id(&uuid, i as u64);
                    let mut body = message(role, text, false);
                    if let JournalBody::Message(m) = &mut body {
                        m.parent_call_id = parent.clone();
                    }
                    out.push(Out::Row(self.book.put(&id, Some(&turn), body)));
                    self.book.retire(&id);
                }
                Some("tool_use") => {
                    let call_id = str_at(block, "id").unwrap_or_default().to_string();
                    let name = str_at(block, "name").unwrap_or_default().to_string();
                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                    if name == "TodoWrite" {
                        if let Some(plan) = tools::plan(&input) {
                            let id = format!("plan:{turn}");
                            let body = JournalBody::Plan(plan);
                            out.push(Out::Row(self.book.put(&id, Some(&turn), body)));
                        }
                    } else if !tools::is_quiet(&name) {
                        let subagent = subagents::subagent_of(&name, &input).map(Box::new);
                        if subagent.is_some() {
                            self.started_subagent(&call_id, &turn, out);
                        }
                        let body = JournalBody::Tool(ToolCall {
                            call_id: call_id.clone(),
                            name: name.clone(),
                            input: tools::cap_input(&input),
                            state: ToolState::Running,
                            output: None,
                            parent_call_id: parent.clone(),
                            subagent,
                        });
                        let id = format!("tool:{call_id}");
                        out.push(Out::Row(self.book.put(&id, Some(&turn), body)));
                    }
                    let parent = parent.clone();
                    self.tools.insert(
                        call_id,
                        PendingCall {
                            name,
                            input,
                            parent,
                        },
                    );
                }
                _ => {}
            }
        }
    }

    fn tool_results(&mut self, m: &Value, out: &mut Vec<Out>) {
        let blocks = m["message"]["content"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let results: Vec<&Value> = blocks
            .iter()
            .filter(|b| str_at(b, "type") == Some("tool_result"))
            .collect();
        // `tool_use_result` describes the line's one result; with several it's unclear.
        let detail = (results.len() == 1)
            .then(|| m.get("tool_use_result"))
            .flatten();
        for block in results {
            let call_id = str_at(block, "tool_use_id").unwrap_or_default();
            let Some(PendingCall { name, input, .. }) = self.tools.remove(call_id) else {
                continue;
            };
            if tools::is_quiet(&name) {
                continue;
            }
            let failed = block["is_error"].as_bool().unwrap_or(false);
            let mut output = tools::result_text(block.get("content"));
            if self.subagents.contains_key(call_id) {
                output = handback::unwrap(&output);
            }
            let id = format!("tool:{call_id}");
            let row = self.book.update(&id, |body| {
                if let JournalBody::Tool(t) = body {
                    t.state = if failed {
                        ToolState::Failed
                    } else {
                        ToolState::Completed
                    };
                    t.output = Some(output);
                }
            });
            let turn = row.as_ref().and_then(|r| r.turn_id.clone());
            out.extend(row.map(Out::Row));
            if self.subagents.contains_key(call_id) {
                // Its row stays open until the subagent itself is done.
                self.subagent_call_done(call_id, failed, detail, out);
                continue;
            }
            self.book.retire(&id);
            if failed {
                continue;
            }
            if let Some(diff) = tools::diff(call_id, &name, &input, detail) {
                let id = format!("diff:{call_id}");
                let row = self.book.put(&id, turn.as_deref(), JournalBody::Diff(diff));
                out.push(Out::Row(row));
                self.book.retire(&id);
            }
        }
    }

    /// Whose rules answer this agent's permission prompts (`crate::permissions`).
    pub fn decides_for(&mut self, workspace_id: &str) {
        self.workspace_id = workspace_id.to_string();
    }

    fn control_request(&mut self, m: &Value, out: &mut Vec<Out>) {
        let request_id = str_at(m, "request_id").unwrap_or_default().to_string();
        let req = &m["request"];
        if str_at(req, "subtype") == Some("mcp_message")
            && str_at(req, "server_name") == Some(TOOLS_SERVER)
        {
            out.push(Out::Mcp {
                request_id,
                message: req["message"].clone(),
            });
            return;
        }
        if str_at(req, "subtype") != Some("can_use_tool") {
            // Hooks would come this way; trace registers none.
            out.push(Out::Reply(json!({
                "type": "control_response",
                "response": {"subtype": "error", "request_id": request_id,
                             "error": "Not supported by trace."},
            })));
            return;
        }
        // In trace's own mode every call arrives here, bypassing Claude's checks:
        // the rules answer most of them, and only what they leave open is a card.
        // A question is for the user whatever the rules say, so it goes straight on.
        let tool = str_at(req, "tool_name").unwrap_or_default();
        if tool != "AskUserQuestion" && crate::permissions::trace_decides(&self.workspace_id, true)
        {
            let input = req.get("input").cloned().unwrap_or(Value::Null);
            match crate::permissions::decide(&self.workspace_id, tool, &input) {
                crate::permissions::Decision::Allow => {
                    out.push(Out::Reply(prompts::allow(&request_id, &input)));
                    return;
                }
                crate::permissions::Decision::Deny(why) => {
                    out.push(Out::Reply(prompts::deny(&request_id, &why)));
                    return;
                }
                crate::permissions::Decision::Ask => {}
            }
        }
        // A subagent's prompt belongs to its turn, which may have ended.
        let parent = str_at(req, "tool_use_id")
            .and_then(|c| self.tools.get(c))
            .and_then(|c| c.parent.clone());
        let turn = self.row_turn(parent.as_deref(), out);
        let (body, pending) = if str_at(req, "tool_name") == Some("AskUserQuestion") {
            let (set, pending) = prompts::questions(&request_id, req);
            (JournalBody::Question(set), pending)
        } else {
            let (approval, pending) = prompts::approval(&request_id, req);
            (JournalBody::Approval(approval), pending)
        };
        out.push(Out::Row(self.book.put(&pending.row_id, Some(&turn), body)));
        self.pending.insert(request_id, pending);
    }

    /// A status row of trace's own (a prompt that couldn't be answered).
    pub fn notice(&mut self, text: &str, tone: Tone) -> Vec<Out> {
        let mut out = Vec::new();
        self.status(text, tone, &mut out);
        out
    }

    fn status(&mut self, text: &str, tone: Tone, out: &mut Vec<Out>) {
        let id = format!("status:{}", self.book.next_seq());
        let turn = self.turn.as_ref().map(|t| t.id.clone());
        let body = JournalBody::Status(Status {
            text: text.to_string(),
            tone,
        });
        out.push(Out::Row(self.book.put(&id, turn.as_deref(), body)));
        self.book.retire(&id);
    }
}

fn message(role: Role, text: &str, streaming: bool) -> JournalBody {
    JournalBody::Message(Message {
        role,
        text: text.to_string(),
        streaming,
        parent_call_id: None,
        attachments: Vec::new(),
    })
}
