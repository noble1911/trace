//! A turn that ends by scheduling its own wake-up is waiting, not finished.
//!
//! `ScheduleWakeup` (Claude Code's self-paced `/loop`) is a timer *inside* the
//! session, so it never appears in a Stop's `background_tasks`. A run that ends
//! a turn with "check the PR again in 20 minutes" looked done, and finishing it
//! killed the PTY — and the timer with it. The call is in the conversation file
//! though, so the turn that just ended is read back for it.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

/// How much of the conversation's tail is read. A turn's own entries are what
/// matter, and a single turn rarely writes more than this.
const TAIL_BYTES: u64 = 2 * 1024 * 1024;

/// The bounds Claude Code clamps a wake-up delay to.
const MIN_DELAY: u64 = 60;
const MAX_DELAY: u64 = 3_600;

/// When the turn that just ended scheduled a wake-up: its delay. `None` when it
/// didn't, or when its last `ScheduleWakeup` ended the loop (`stop: true`).
pub fn pending_wakeup(transcript_path: &str) -> Option<Duration> {
    last_turn_wakeup(&read_tail(transcript_path)?)
}

fn read_tail(path: &str) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(TAIL_BYTES)))
        .ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

#[derive(Deserialize)]
struct Entry {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    #[serde(default)]
    content: Value,
}

/// Walks the conversation back from its end to where the last turn opened,
/// returning the delay of that turn's latest `ScheduleWakeup`.
fn last_turn_wakeup(conversation: &str) -> Option<Duration> {
    for line in conversation.lines().rev() {
        let Ok(entry) = serde_json::from_str::<Entry>(line) else {
            continue; // the torn first line of the tail, or a partial last one
        };
        let content = entry.message.map(|m| m.content).unwrap_or(Value::Null);
        match entry.kind.as_str() {
            "assistant" => {
                if let Some(input) = wakeup_input(&content) {
                    if input.get("stop").and_then(Value::as_bool) == Some(true) {
                        return None;
                    }
                    let secs = input.get("delaySeconds").and_then(Value::as_u64)?;
                    return Some(Duration::from_secs(secs.clamp(MIN_DELAY, MAX_DELAY)));
                }
            }
            // Tool results are `user` entries inside the turn; anything else a
            // `user` entry carries (a prompt, a task notification, a wake-up's own
            // prompt) is what opened the turn.
            "user" if !is_tool_result(&content) => return None,
            _ => {}
        }
    }
    None
}

/// The input of a `ScheduleWakeup` call in an assistant entry, if it has one.
fn wakeup_input(content: &Value) -> Option<&Value> {
    content.as_array()?.iter().rev().find_map(|part| {
        let is_wakeup = part.get("type").and_then(Value::as_str) == Some("tool_use")
            && part.get("name").and_then(Value::as_str) == Some("ScheduleWakeup");
        is_wakeup.then(|| part.get("input")).flatten()
    })
}

fn is_tool_result(content: &Value) -> bool {
    content.as_array().is_some_and(|parts| {
        !parts.is_empty()
            && parts
                .iter()
                .all(|p| p.get("type").and_then(Value::as_str) == Some("tool_result"))
    })
}

#[cfg(test)]
mod tests {
    use super::last_turn_wakeup;
    use std::time::Duration;

    fn assistant_tool(name: &str, input: &str) -> String {
        format!(
            r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","name":"{name}","input":{input}}}]}}}}"#
        )
    }
    const TOOL_RESULT: &str =
        r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}"#;
    const PROMPT: &str = r#"{"type":"user","message":{"content":"Review the PR"}}"#;
    const CLOSING: &str =
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Done for now."}]}}"#;
    const BOOKKEEPING: &str = r#"{"type":"system","subtype":"turn_duration"}"#;

    fn lines(entries: &[&str]) -> String {
        entries.join("\n")
    }

    #[test]
    fn finds_a_wakeup_scheduled_in_the_last_turn() {
        // A turn that schedules an 18-minute check-in, then closes.
        let wakeup = assistant_tool("ScheduleWakeup", r#"{"delaySeconds":1080,"prompt":"x"}"#);
        let convo = lines(&[PROMPT, &wakeup, TOOL_RESULT, CLOSING, BOOKKEEPING]);

        assert_eq!(last_turn_wakeup(&convo), Some(Duration::from_secs(1080)));
    }

    #[test]
    fn ignores_a_wakeup_from_an_earlier_turn() {
        // A wake-up that already fired: its prompt opened the turn after it.
        let wakeup = assistant_tool("ScheduleWakeup", r#"{"delaySeconds":600,"prompt":"x"}"#);
        let convo = lines(&[PROMPT, &wakeup, TOOL_RESULT, CLOSING, PROMPT, CLOSING]);

        assert_eq!(last_turn_wakeup(&convo), None);
    }

    #[test]
    fn a_stop_ends_the_loop() {
        let scheduled = assistant_tool("ScheduleWakeup", r#"{"delaySeconds":600,"prompt":"x"}"#);
        let stopped = assistant_tool("ScheduleWakeup", r#"{"stop":true}"#);
        let convo = lines(&[
            PROMPT,
            &scheduled,
            TOOL_RESULT,
            &stopped,
            TOOL_RESULT,
            CLOSING,
        ]);

        assert_eq!(last_turn_wakeup(&convo), None);
    }

    #[test]
    fn clamps_the_delay_like_claude_code() {
        let short = assistant_tool("ScheduleWakeup", r#"{"delaySeconds":5,"prompt":"x"}"#);
        let long = assistant_tool("ScheduleWakeup", r#"{"delaySeconds":99999,"prompt":"x"}"#);

        assert_eq!(
            last_turn_wakeup(&lines(&[PROMPT, &short])),
            Some(Duration::from_secs(60))
        );
        assert_eq!(
            last_turn_wakeup(&lines(&[PROMPT, &long])),
            Some(Duration::from_secs(3_600))
        );
    }

    #[test]
    fn no_wakeup_in_an_ordinary_turn() {
        let bash = assistant_tool("Bash", r#"{"command":"ls"}"#);
        let convo = lines(&[PROMPT, &bash, TOOL_RESULT, CLOSING]);

        assert_eq!(last_turn_wakeup(&convo), None);
    }
}
