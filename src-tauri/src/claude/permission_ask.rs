//! What a Claude agent's permission dialog is actually asking.
//!
//! The Notification hook can't say: a Bash permission, a plan approval and an
//! `AskUserQuestion` all arrive as `permission_prompt` / "Claude needs your
//! permission". The `PermissionRequest` hook fires just before the dialog shows
//! and names the tool and its input, so trace relays a short summary of it
//! (`agent-ask`) — which the renderer labels and, for simple menus, answers.
//!
//! Only a summary crosses: the tool, one line of its input (a command, a path,
//! the question), the question's options, and whether Claude offers a "don't ask
//! again" rule. File contents an `Edit`/`Write` carries never leave this module.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// Longest one-line detail the renderer gets (a command, a question, a plan's start).
const DETAIL_CHARS: usize = 300;

#[derive(Deserialize, Default)]
struct PermissionInput {
    tool_name: Option<String>,
    tool_input: Option<Value>,
    /// The "don't ask again" rules Claude would offer; absent or empty means its
    /// dialog has no such option.
    permission_suggestions: Option<Vec<Value>>,
}

/// `agent-ask` event payload.
#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAsk {
    workspace_id: String,
    tool: String,
    /// The command, path, URL, question or plan the dialog is about.
    detail: Option<String>,
    /// `AskUserQuestion`: the first question's option labels, in menu order.
    options: Vec<String>,
    multi_select: bool,
    /// `AskUserQuestion`: how many questions it asks (only a single one is
    /// answerable from outside the terminal).
    questions: usize,
    /// Whether the dialog offers "Yes, and don't ask again".
    can_always_allow: bool,
}

/// Relay a `PermissionRequest` hook's input (base64 JSON) from agent `ws`.
pub fn on_request(app: &AppHandle, ws: &str, payload: &str) {
    if let Some(ask) = summarize(ws, payload) {
        let _ = app.emit("agent-ask", ask);
    }
}

fn summarize(ws: &str, payload: &str) -> Option<AgentAsk> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .ok()?;
    let input: PermissionInput = serde_json::from_slice(&bytes).ok()?;
    let tool = input.tool_name?;
    let args = input.tool_input.unwrap_or(Value::Null);
    let text = |key: &str| args.get(key).and_then(Value::as_str).map(str::to_string);

    let mut ask = AgentAsk {
        workspace_id: ws.to_string(),
        tool: tool.clone(),
        detail: None,
        options: Vec::new(),
        multi_select: false,
        questions: 0,
        can_always_allow: input.permission_suggestions.is_some_and(|s| !s.is_empty()),
    };
    ask.detail = match tool.as_str() {
        "AskUserQuestion" => {
            let questions = args.get("questions").and_then(Value::as_array);
            let first = questions.and_then(|q| q.first());
            ask.questions = questions.map_or(0, Vec::len);
            ask.multi_select = first
                .and_then(|q| q.get("multiSelect"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            ask.options = first
                .and_then(|q| q.get("options"))
                .and_then(Value::as_array)
                .map(|opts| {
                    opts.iter()
                        .filter_map(|o| o.get("label").and_then(Value::as_str))
                        .map(|l| crate::activity::clip(l, 80))
                        .collect()
                })
                .unwrap_or_default();
            first
                .and_then(|q| q.get("question"))
                .and_then(Value::as_str)
                .map(str::to_string)
        }
        "ExitPlanMode" => text("plan"),
        "Bash" => text("command"),
        "Edit" | "MultiEdit" | "Write" | "Read" => text("file_path"),
        "NotebookEdit" => text("notebook_path"),
        "WebFetch" => text("url"),
        "WebSearch" => text("query"),
        _ => None,
    }
    .map(|d| crate::activity::clip(&d, DETAIL_CHARS));
    Some(ask)
}

#[cfg(test)]
mod tests {
    use super::summarize;
    use base64::Engine;

    fn enc(json: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(json)
    }

    #[test]
    fn a_question_carries_its_options() {
        // Captured from Claude Code 2.1.310's PermissionRequest hook.
        let json = r#"{"hook_event_name":"PermissionRequest","tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Which colour do you prefer, red or blue?","header":"Colour","options":[{"label":"Red","description":"r"},{"label":"Blue","description":"b"}],"multiSelect":false}]}}"#;
        let ask = summarize("ws", &enc(json)).expect("summary");
        assert_eq!(ask.tool, "AskUserQuestion");
        assert_eq!(
            ask.detail.as_deref(),
            Some("Which colour do you prefer, red or blue?")
        );
        assert_eq!(ask.options, vec!["Red", "Blue"]);
        assert_eq!(ask.questions, 1);
        assert!(!ask.multi_select);
        assert!(!ask.can_always_allow);
    }

    #[test]
    fn a_bash_permission_names_its_command_and_rule() {
        let json = r#"{"tool_name":"Bash","tool_input":{"command":"mkdir -p /tmp/x","description":"d"},"permission_suggestions":[{"type":"addRules"}]}"#;
        let ask = summarize("ws", &enc(json)).expect("summary");
        assert_eq!(ask.detail.as_deref(), Some("mkdir -p /tmp/x"));
        assert!(ask.can_always_allow);
        assert!(ask.options.is_empty());
    }

    #[test]
    fn file_contents_never_cross() {
        let json =
            r#"{"tool_name":"Write","tool_input":{"file_path":"/a/b.rs","content":"SECRET BODY"}}"#;
        let ask = summarize("ws", &enc(json)).expect("summary");
        assert_eq!(ask.detail.as_deref(), Some("/a/b.rs"));
        assert!(!format!("{ask:?}").contains("SECRET"));
    }

    #[test]
    fn junk_is_dropped() {
        assert!(summarize("ws", "not base64!").is_none());
        assert!(summarize("ws", &enc(r#"{"tool_input":{}}"#)).is_none());
    }
}
