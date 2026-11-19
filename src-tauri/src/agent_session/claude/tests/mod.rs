//! The translator against stream-json recorded from a real `claude` (2.1.319,
//! `--model haiku`, scrubbed: paths are `/home/dev/demo`, ids renumbered). Lines
//! starting `>>> ` are what was written to Claude's stdin: the replay makes the
//! same move through the translator and checks it writes exactly that line.

use serde_json::json;

mod replay;
mod subagents;
mod tasks;

use super::translate::Translator;
use crate::agent_session::journal::*;
use replay::{message_text, replay, replay_until, Run};

const EDITS: &str = include_str!("../fixtures/edits_and_question.jsonl");
const DENY: &str = include_str!("../fixtures/deny.jsonl");
const INTERRUPT: &str = include_str!("../fixtures/interrupt.jsonl");
const TODO: &str = include_str!("../fixtures/todo.jsonl");

#[test]
fn text_streams_into_one_row_that_ends_with_the_full_answer() {
    let run = replay(EDITS);
    let done = run
        .sorted()
        .into_iter()
        .find(|r| message_text(&r.body).is_some_and(|(_, t)| t.starts_with("Done.")))
        .expect("the closing message");
    let (m, text) = message_text(&done.body).unwrap();
    assert_eq!(m.role, Role::Assistant);
    assert!(!m.streaming);
    assert!(text.ends_with("and `echo hi` printed `hi`."), "{text}");
    // It arrived in pieces, as revisions of the same row.
    let pieces: Vec<&JournalRow> = run.revisions.iter().filter(|r| r.id == done.id).collect();
    assert!(pieces.len() > 2);
    assert!(pieces[..pieces.len() - 1].iter().all(|r| matches!(
        &r.body, JournalBody::Message(m) if m.streaming
    )));
    // The final `assistant` line's copy of that text adds no second row.
    let copies = run
        .bodies()
        .into_iter()
        .filter(|b| message_text(b).is_some_and(|(_, t)| t.starts_with("Done.")))
        .count();
    assert_eq!(copies, 1);
}

#[test]
fn a_tool_call_completes_with_its_result() {
    let run = replay(EDITS);
    let tools = run.tools();
    let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
    // The second turn looks for TodoWrite, which this build doesn't have.
    assert_eq!(names, ["Write", "Read", "Edit", "Bash", "ToolSearch"]);
    assert!(tools.iter().all(|t| t.state == ToolState::Completed));
    let bash = tools[3];
    assert_eq!(bash.input["command"], "echo hi");
    assert!(bash.output.as_deref().unwrap().starts_with("hi\n"));
}

#[test]
fn edit_and_write_become_diffs() {
    let run = replay(EDITS);
    let diffs: Vec<&FileDiff> = run
        .bodies()
        .into_iter()
        .filter_map(|b| match b {
            JournalBody::Diff(d) => Some(d),
            _ => None,
        })
        .collect();
    assert_eq!(diffs.len(), 2);
    let (write, edit) = (diffs[0], diffs[1]);
    assert_eq!(write.path, "/home/dev/demo/notes.txt");
    assert_eq!(write.change, ChangeKind::Add);
    assert_eq!(write.after.as_deref(), Some("alpha"));
    assert_eq!(write.before, None);
    assert_eq!(edit.change, ChangeKind::Edit);
    assert_eq!(
        (edit.before.as_deref(), edit.after.as_deref()),
        (Some("alpha"), Some("beta"))
    );
    let patch = edit.patch.as_deref().unwrap();
    assert!(patch.starts_with("@@ -1,1 +1,1 @@\n-alpha\n"), "{patch}");
    assert!(patch.contains("+beta"));
}

#[test]
fn can_use_tool_is_an_approval_answered_in_place() {
    let run = replay(EDITS);
    let approvals: Vec<&Approval> = run
        .bodies()
        .into_iter()
        .filter_map(|b| match b {
            JournalBody::Approval(a) => Some(a),
            _ => None,
        })
        .collect();
    assert_eq!(approvals.len(), 2);
    let write = approvals[0];
    assert_eq!(write.tool, "Write");
    assert_eq!(write.title, "Write /home/dev/demo/notes.txt");
    let write_tool = run.tools()[0];
    assert_eq!(write.call_id.as_deref(), Some(write_tool.call_id.as_str()));
    let options: Vec<(&str, &str, ApprovalKind)> = write
        .options
        .iter()
        .map(|o| (o.id.as_str(), o.label.as_str(), o.kind))
        .collect();
    assert_eq!(
        options,
        [
            ("allow", "Allow once", ApprovalKind::AllowOnce),
            (
                "always:0",
                "Allow all edits this session",
                ApprovalKind::AllowAlways
            ),
            ("deny", "Deny", ApprovalKind::Deny),
        ]
    );
    let allowed = Resolution::Answered {
        answer: Answer::Approval {
            option_id: "allow".into(),
            note: None,
        },
    };
    assert!(approvals
        .iter()
        .all(|a| a.resolution.as_ref() == Some(&allowed)));
}

#[test]
fn allow_always_sends_the_chosen_suggestion() {
    let mut tr = Translator::new(0, || 0);
    let mut run = Run::default();
    replay_until(
        &mut tr,
        &mut run,
        EDITS,
        Some(r#">>> {"type":"control_response""#),
    );
    let JournalBody::Approval(a) = run
        .bodies()
        .into_iter()
        .rev()
        .find(|b| matches!(b, JournalBody::Approval(_)))
        .unwrap()
        .clone()
    else {
        unreachable!()
    };
    let answer = Answer::Approval {
        option_id: "always:0".into(),
        note: None,
    };
    let replies = run.take(tr.answer(&a.request_id, answer).unwrap());
    let decision = &replies[0]["response"]["response"];
    assert_eq!(decision["behavior"], "allow");
    assert_eq!(
        decision["updatedPermissions"],
        json!([{"type": "setMode", "mode": "acceptEdits", "destination": "session"}])
    );
    // Answered once: a second answer finds nothing open.
    let again = Answer::Approval {
        option_id: "allow".into(),
        note: None,
    };
    assert!(tr.answer(&a.request_id, again).is_err());
}

#[test]
fn a_denial_fails_the_tool_and_shows_no_diff() {
    let run = replay(DENY);
    let JournalBody::Approval(a) = run
        .bodies()
        .into_iter()
        .find(|b| matches!(b, JournalBody::Approval(_)))
        .unwrap()
    else {
        unreachable!()
    };
    assert_eq!(a.title, "Run mkdir x1");
    assert_eq!(a.detail.as_deref(), Some("mkdir x1"));
    assert_eq!(a.options[1].label, "Always allow Bash(mkdir x1 *)");
    let tool = run.tools()[0];
    assert_eq!(tool.state, ToolState::Failed);
    assert_eq!(tool.output.as_deref(), Some("The user declined this."));
    assert!(!run
        .bodies()
        .iter()
        .any(|b| matches!(b, JournalBody::Diff(_))));
    assert_eq!(run.turns()[0].state, TurnState::Completed);
}

#[test]
fn ask_user_question_is_a_question_row_answered_by_label() {
    let run = replay(EDITS);
    let JournalBody::Question(set) = run
        .bodies()
        .into_iter()
        .find(|b| matches!(b, JournalBody::Question(_)))
        .unwrap()
    else {
        unreachable!()
    };
    let q = &set.questions[0];
    assert_eq!(q.header.as_deref(), Some("Color"));
    assert_eq!(q.text, "Which color do you prefer?");
    let labels: Vec<&str> = q.options.iter().map(|o| o.label.as_str()).collect();
    assert_eq!(labels, ["Red", "Blue"]);
    assert!(!q.multi_select);
    let Some(Resolution::Answered {
        answer: Answer::Questions { answers },
    }) = &set.resolution
    else {
        panic!("unanswered: {:?}", set.resolution);
    };
    assert_eq!(answers["q0"], ["Blue"]);
    // The question card stands in for the tool call.
    assert!(!run.tools().iter().any(|t| t.name == "AskUserQuestion"));
}

#[test]
fn todo_write_is_a_plan() {
    let run = replay(TODO);
    let plans: Vec<&Plan> = run
        .bodies()
        .into_iter()
        .filter_map(|b| match b {
            JournalBody::Plan(p) => Some(p),
            _ => None,
        })
        .collect();
    assert_eq!(plans.len(), 1);
    let items: Vec<(&str, PlanStatus)> = plans[0]
        .items
        .iter()
        .map(|i| (i.text.as_str(), i.status))
        .collect();
    assert_eq!(
        items,
        [
            ("read", PlanStatus::InProgress),
            ("write", PlanStatus::Pending)
        ]
    );
    assert!(run.tools().iter().all(|t| t.name != "TodoWrite"));
}

#[test]
fn an_interrupted_turn_ends_interrupted_and_the_next_one_runs() {
    let run = replay(INTERRUPT);
    let turns = run.turns();
    let states: Vec<TurnState> = turns.iter().map(|t| t.state).collect();
    assert_eq!(states, [TurnState::Interrupted, TurnState::Completed]);
    // The fixture starts mid-session: the first total is the earlier turns'.
    let cut = turns[0].usage.as_ref().unwrap();
    assert_eq!((cut.input_tokens, cut.output_tokens), (0, 0));
    let next = turns[1].usage.as_ref().unwrap().cost_usd.unwrap();
    assert!((next - (0.00305565 - 0.00269724)).abs() < 1e-12);
    // Nothing is left streaming, and an interrupt is not an error.
    assert!(!run
        .bodies()
        .iter()
        .any(|b| matches!(b, JournalBody::Message(m) if m.streaming)));
    assert!(!run
        .bodies()
        .iter()
        .any(|b| matches!(b, JournalBody::Status(_))));
    assert!(!run.info.busy);
}

#[test]
fn result_carries_usage_and_each_turns_cost() {
    let run = replay(EDITS);
    let turns = run.turns();
    assert_eq!(turns.len(), 2);
    let first = turns[0].usage.as_ref().unwrap();
    assert_eq!((first.input_tokens, first.output_tokens), (8, 654));
    assert_eq!(
        (first.cache_read_tokens, first.cache_write_tokens),
        (109_264, 13_178)
    );
    assert_eq!(first.cost_usd, Some(0.00405604));
    let second = turns[1].usage.as_ref().unwrap().cost_usd.unwrap();
    assert!((second - (0.00533535 - 0.00405604)).abs() < 1e-12);
    assert!(turns
        .iter()
        .all(|t| t.state == TurnState::Completed && t.duration_ms.is_some()));
    // Every row of a turn carries its id.
    let user_turns: Vec<&str> = run
        .sorted()
        .into_iter()
        .filter(|r| matches!(&r.body, JournalBody::Message(m) if m.role == Role::User))
        .map(|r| r.turn_id.as_deref().unwrap())
        .collect();
    assert_eq!(
        user_turns,
        [turns[0].turn_id.as_str(), turns[1].turn_id.as_str()]
    );
}

#[test]
fn init_and_rate_limits_fill_the_session_info() {
    let run = replay(EDITS);
    let info = &run.info;
    assert_eq!(info.agent, "claude");
    assert_eq!(info.model.as_deref(), Some("claude-haiku-5-5"));
    assert_eq!(
        info.conversation_id.as_deref(),
        Some("00000000-0000-4000-8000-000000000001")
    );
    assert!(info.slash_commands.iter().any(|c| c == "compact"));
    assert_eq!(info.limits.len(), 1);
    assert_eq!(info.limits[0].name, "seven_day");
    assert_eq!(info.limits[0].utilization, 0.32);
    assert_eq!(info.limits[0].resets_at, Some(1_794_182_400));
    assert!(!info.busy);
}

#[test]
fn the_process_ending_mid_turn_settles_what_was_open() {
    let mut tr = Translator::new(0, || 0);
    let mut run = Run::default();
    // Up to the moment the approval is waiting.
    replay_until(
        &mut tr,
        &mut run,
        DENY,
        Some(r#">>> {"type":"control_response""#),
    );
    assert!(run.info.busy);
    run.take(tr.exited(Some("Claude exited (exit code: 1).")));
    let JournalBody::Approval(a) = run
        .bodies()
        .into_iter()
        .find(|b| matches!(b, JournalBody::Approval(_)))
        .unwrap()
    else {
        unreachable!()
    };
    assert_eq!(a.resolution, Some(Resolution::Cancelled));
    assert_eq!(run.tools()[0].state, ToolState::Failed);
    assert_eq!(run.turns()[0].state, TurnState::Failed);
    let status = run.bodies().into_iter().find_map(|b| match b {
        JournalBody::Status(s) => Some(s.clone()),
        _ => None,
    });
    assert_eq!(status.map(|s| s.tone), Some(Tone::Error));
    assert!(!run.info.busy);
}

#[test]
fn other_control_requests_are_refused_so_claude_doesnt_wait() {
    let mut tr = Translator::new(0, || 0);
    let line =
        r#"{"type":"control_request","request_id":"r1","request":{"subtype":"hook_callback"}}"#;
    let mut run = Run::default();
    let replies = run.take(tr.line(line));
    assert_eq!(replies[0]["response"]["subtype"], "error");
    assert_eq!(replies[0]["response"]["request_id"], "r1");
}

#[test]
fn a_user_row_keeps_its_attachments_beside_the_text() {
    let mut tr = Translator::new(0, || 0);
    let mut run = Run::default();
    let files = vec!["/tmp/a.png".to_string(), "/tmp/notes.txt".to_string()];
    run.take(tr.send("Look", &files, json!("Look")));
    let user = run.bodies().into_iter().find_map(|b| match b {
        JournalBody::Message(m) if m.role == Role::User => Some(m.clone()),
        _ => None,
    });
    let user = user.unwrap();
    assert_eq!(user.text, "Look");
    assert_eq!(user.attachments, files);
}

#[test]
fn messages_whose_stream_carries_no_id_get_a_row_each() {
    // Some builds send stream events with no message id on them. Each message
    // still needs its own row: on one shared id the second message's revisions
    // start at 0 again, which reads as a stale copy of the first and is dropped.
    let mut tr = Translator::new(0, || 0);
    let mut run = Run::default();
    for text in ["first", "second"] {
        for line in [
            json!({"type": "stream_event", "event": {"type": "message_start", "message": {}}}),
            json!({"type": "stream_event", "event": {
                "type": "content_block_start", "index": 1, "content_block": {"type": "text"}
            }}),
            json!({"type": "stream_event", "event": {
                "type": "content_block_delta", "index": 1, "delta": {"text": text}
            }}),
            json!({"type": "stream_event", "event": {"type": "content_block_stop", "index": 1}}),
        ] {
            run.take(tr.line(&line.to_string()));
        }
    }
    let said: Vec<(&str, &str)> = run
        .sorted()
        .into_iter()
        .filter_map(|r| message_text(&r.body).map(|(_, t)| (r.id.as_str(), t)))
        .collect();
    assert_eq!(said.len(), 2, "{said:?}");
    assert_ne!(said[0].0, said[1].0, "both messages landed on one row id");
    assert_eq!([said[0].1, said[1].1], ["first", "second"]);
}
