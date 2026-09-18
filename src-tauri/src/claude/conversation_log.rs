//! Reading a Claude conversation back as something you can read.
//!
//! A finished run's PTY recording only replays its *last screen*: the TUI paints
//! on the terminal's alternate screen, which by definition has no scrollback, so
//! everything above the final 30-odd rows is unreachable. The conversation
//! itself is on disk though — Claude appends it as JSONL next to the cwd it ran
//! in (`conversations::conversation_path`) — so trace reads that instead and
//! shows the turns as scrollable text.
//!
//! The file is Claude Code's own format, so this parses defensively: unknown
//! entry kinds and malformed lines are skipped, never fatal, and the PTY replay
//! stays as the fallback view.

use serde::{Deserialize, Serialize};

/// Entries kept, newest-biased: a long run can log thousands.
const MAX_ENTRIES: usize = 500;

/// Longest single entry kept; a pasted file or huge reply is cut with an ellipsis.
const MAX_TEXT: usize = 20_000;

/// One displayable turn part.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// "prompt" (what was asked), "reply" (Claude's text), "tool" (a tool call),
    /// "notice" (a background task reporting back).
    pub kind: String,
    pub text: String,
    /// Tool name, for `tool` entries.
    pub tool: Option<String>,
    /// RFC3339 timestamp as Claude recorded it, when present.
    pub at: Option<String>,
}

/// Raw JSONL line shapes, narrowed to what's displayable.
#[derive(Deserialize)]
struct RawEntry {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    message: Option<RawMessage>,
}

#[derive(Deserialize)]
struct RawMessage {
    #[serde(default)]
    content: Option<RawContent>,
}

/// `content` is a bare string (a typed prompt) or a list of blocks.
#[derive(Deserialize)]
#[serde(untagged)]
enum RawContent {
    Text(String),
    Blocks(Vec<RawBlock>),
}

#[derive(Deserialize)]
struct RawBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    input: Option<serde_json::Value>,
}

/// Read a conversation for display. `None` when it isn't on disk (Claude prunes
/// old conversations, and a never-started run has none).
pub fn read(cwd: &str, session_id: &str) -> Option<Vec<LogEntry>> {
    let path = super::conversations::conversation_path(cwd, session_id)?;
    let raw = std::fs::read_to_string(path).ok()?;
    Some(parse(&raw))
}

fn parse(jsonl: &str) -> Vec<LogEntry> {
    let mut out: Vec<LogEntry> = Vec::new();
    for line in jsonl.lines() {
        let Ok(entry) = serde_json::from_str::<RawEntry>(line) else {
            continue;
        };
        let Some(content) = entry.message.and_then(|m| m.content) else {
            continue;
        };
        let at = entry.timestamp;
        match (entry.kind.as_str(), content) {
            ("user", RawContent::Text(text)) => out.extend(user_text(&text, at)),
            // Tool results are the raw material of the reply that follows them —
            // noise on their own, and often enormous.
            ("user", RawContent::Blocks(_)) => {}
            ("assistant", RawContent::Blocks(blocks)) => {
                for block in blocks {
                    out.extend(assistant_block(block, at.clone()));
                }
            }
            _ => {}
        }
    }
    if out.len() > MAX_ENTRIES {
        out.drain(..out.len() - MAX_ENTRIES);
    }
    out
}

/// A user entry is the prompt, a background task reporting back, or one of the
/// harness's own reminders (which nobody typed and nobody needs to read).
fn user_text(text: &str, at: Option<String>) -> Option<LogEntry> {
    let trimmed = text.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("<system-reminder")
        || trimmed.starts_with("Caveat:")
    {
        return None;
    }
    if trimmed.starts_with("<task-notification") {
        return Some(LogEntry {
            kind: "notice".to_string(),
            text: "A background task reported back.".to_string(),
            tool: None,
            at,
        });
    }
    Some(LogEntry {
        kind: "prompt".to_string(),
        text: clip(trimmed),
        tool: None,
        at,
    })
}

fn assistant_block(block: RawBlock, at: Option<String>) -> Option<LogEntry> {
    match block.kind.as_str() {
        "text" => {
            let text = block.text.unwrap_or_default();
            (!text.trim().is_empty()).then(|| LogEntry {
                kind: "reply".to_string(),
                text: clip(text.trim()),
                tool: None,
                at,
            })
        }
        "tool_use" => {
            let name = block.name.unwrap_or_else(|| "tool".to_string());
            let detail = block.input.as_ref().map(tool_detail).unwrap_or_default();
            Some(LogEntry {
                kind: "tool".to_string(),
                text: clip(detail.trim()),
                tool: Some(name),
                at,
            })
        }
        // "thinking" is Claude's scratchpad, not part of the answer.
        _ => None,
    }
}

/// What a tool call was for: the field that says so, else the first short
/// string in its input — MCP tools name their arguments however they like.
fn tool_detail(input: &serde_json::Value) -> String {
    const NAMED: [&str; 6] = [
        "description",
        "command",
        "prompt",
        "query",
        "pattern",
        "file_path",
    ];
    if let Some(found) = NAMED
        .iter()
        .find_map(|key| input.get(key).and_then(|v| v.as_str()))
    {
        return found.to_string();
    }
    input
        .as_object()
        .and_then(|fields| {
            fields
                .values()
                .filter_map(|v| v.as_str())
                .find(|s| !s.is_empty() && s.chars().count() <= 200)
        })
        .unwrap_or_default()
        .to_string()
}

fn clip(text: &str) -> String {
    if text.chars().count() <= MAX_TEXT {
        return text.to_string();
    }
    text.chars().take(MAX_TEXT).collect::<String>() + "…"
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn keeps_the_readable_turns_and_drops_the_noise() {
        let jsonl = concat!(
            r#"{"type":"user","timestamp":"2026-09-18T09:00:01Z","message":{"content":"Review sentry issues"}}"#,
            "\n",
            r#"{"type":"attachment","attachment":{"type":"environment"}}"#,
            "\n",
            r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"Pulled the list."}]}}"#,
            "\n",
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"gh pr list","description":"List PRs"}}]}}"#,
            "\n",
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"a very long tool result"}]}}"#,
            "\n",
            r#"{"type":"user","message":{"content":"<task-notification>\n<task-id>abc</task-id>"}}"#,
            "\n",
            r#"{"type":"user","message":{"content":"<system-reminder>ignore me</system-reminder>"}}"#,
            "\n",
            "not json at all\n",
            r#"{"type":"system","subtype":"stop_hook_summary"}"#,
            "\n",
        );
        let entries = parse(jsonl);
        let shape: Vec<(&str, &str)> = entries
            .iter()
            .map(|e| (e.kind.as_str(), e.text.as_str()))
            .collect();
        assert_eq!(
            shape,
            vec![
                ("prompt", "Review sentry issues"),
                ("reply", "Pulled the list."),
                ("tool", "List PRs"),
                ("notice", "A background task reported back."),
            ]
        );
        assert_eq!(entries[2].tool.as_deref(), Some("Bash"));
        assert_eq!(entries[0].at.as_deref(), Some("2026-09-18T09:00:01Z"));
    }

    #[test]
    fn describes_a_tool_call_from_whatever_its_input_offers() {
        let call = |input: &str| {
            let line = format!(
                r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","name":"T","input":{input}}}]}}}}"#
            );
            parse(&line)
                .first()
                .map(|e| e.text.clone())
                .unwrap_or_default()
        };
        assert_eq!(call(r#"{"command":"ls -la"}"#), "ls -la");
        // description wins over other fields.
        assert_eq!(
            call(r#"{"command":"ls","description":"List files"}"#),
            "List files"
        );
        // An MCP tool naming its arguments its own way still says something.
        assert_eq!(call(r#"{"organizationSlug":"acme"}"#), "acme");
        // Nothing usable (numbers, or an essay) rather than a wall of text.
        assert_eq!(call(r#"{"limit":10}"#), "");
    }
}
