use std::sync::mpsc::{channel, Receiver};

use super::super::testing::FakeBackend;
use super::*;

fn handler() -> (Handler, Arc<FakeBackend>, Receiver<Event>) {
    let backend = Arc::new(FakeBackend::default());
    let (tx, rx) = channel();
    (Handler::new(backend.clone(), tx), backend, rx)
}

fn ask(h: &mut Handler, request: Request) -> Vec<Event> {
    h.handle(Envelope {
        id: Some(7),
        request,
    })
}

fn output(seq: u64) -> Event {
    Event::Output {
        workspace_id: "ws1".into(),
        seq,
        data: "eA==".into(),
    }
}

fn attach(h: &mut Handler) -> Vec<Event> {
    ask(
        h,
        Request::Attach {
            workspace_id: "ws1".into(),
            from_seq: 0,
        },
    )
}

#[test]
fn list_answers_with_the_requests_id() {
    let (mut h, _, _) = handler();
    let out = ask(&mut h, Request::List);
    assert!(matches!(&out[..], [Event::Sessions { id: Some(7), sessions }] if sessions.len() == 1));
}

#[test]
fn attach_replays_then_only_newer_live_output_follows() {
    let (mut h, _, _) = handler();
    let out = attach(&mut h);
    assert!(matches!(
        out[0],
        Event::Attached {
            reset: false,
            cols: 100,
            rows: 30,
            ..
        }
    ));
    assert_eq!(out.len(), 3, "attached, then two replayed chunks");
    // Chunk 2 was in the replay; the hub delivering it again must not repeat it.
    assert_eq!(h.live(output(2)), None);
    assert_eq!(h.live(output(3)), Some(output(3)));
    assert_eq!(h.live(output(3)), None);
}

#[test]
fn attaching_to_nothing_is_an_error() {
    let (mut h, _, _) = handler();
    let out = ask(
        &mut h,
        Request::Attach {
            workspace_id: "nope".into(),
            from_seq: 0,
        },
    );
    assert!(matches!(&out[..], [Event::Error { id: Some(7), .. }]));
}

#[test]
fn nothing_is_streamed_until_attached_or_after_detaching() {
    let (mut h, _, _) = handler();
    assert_eq!(h.live(output(5)), None);
    attach(&mut h);
    assert!(h.live(output(5)).is_some());
    ask(
        &mut h,
        Request::Detach {
            workspace_id: "ws1".into(),
        },
    );
    assert_eq!(h.live(output(6)), None);
}

#[test]
fn a_run_ending_lets_the_next_run_count_from_one_again() {
    let (mut h, _, _) = handler();
    attach(&mut h);
    assert!(h.live(output(40)).is_some());
    let ended = Event::RunState {
        workspace_id: "ws1".into(),
        running: false,
        exited: true,
    };
    assert_eq!(h.live(ended.clone()), Some(ended));
    assert_eq!(h.live(output(1)), Some(output(1)));
}

#[test]
fn turns_reach_only_attached_clients() {
    let (mut h, _, _) = handler();
    let turn = Event::Turn {
        workspace_id: "ws1".into(),
        event: "stop".into(),
        background_tasks: 0,
        notification_type: None,
        message: None,
        last_message: None,
    };
    assert_eq!(h.live(turn.clone()), None);
    attach(&mut h);
    assert_eq!(h.live(turn.clone()), Some(turn));
}

#[test]
fn input_is_decoded_and_resize_and_stop_reach_the_backend() {
    let (mut h, backend, _) = handler();
    let id = "ws1".to_string();
    // "hi" in base64.
    assert!(ask(
        &mut h,
        Request::Input {
            workspace_id: id.clone(),
            data: "aGk=".into()
        }
    )
    .is_empty());
    assert!(ask(
        &mut h,
        Request::Resize {
            workspace_id: id.clone(),
            cols: 90,
            rows: 20
        }
    )
    .is_empty());
    assert!(ask(&mut h, Request::Stop { workspace_id: id }).is_empty());
    assert_eq!(
        backend.calls(),
        ["input ws1 hi", "resize ws1 90x20", "stop ws1"]
    );
}

#[test]
fn input_that_isnt_base64_is_an_error_and_never_reaches_the_backend() {
    let (mut h, backend, _) = handler();
    let out = ask(
        &mut h,
        Request::Input {
            workspace_id: "ws1".into(),
            data: "!!".into(),
        },
    );
    assert!(matches!(&out[..], [Event::Error { id: Some(7), .. }]));
    assert!(backend.calls().is_empty());
}

#[test]
fn a_second_hello_is_an_error() {
    let (mut h, _, _) = handler();
    let out = ask(
        &mut h,
        Request::Hello {
            protocol: 1,
            token: "x".into(),
            client_name: "c".into(),
        },
    );
    assert!(matches!(&out[..], [Event::Error { .. }]));
}

#[test]
fn spawn_answers_later_without_holding_the_connection() {
    let (mut h, _, late) = handler();
    let spawn = |repo: &str| Request::Spawn {
        repo: repo.into(),
        cli: "claude".into(),
        prompt: Some("go".into()),
        title: None,
        cols: 80,
        rows: 24,
    };
    assert!(ask(&mut h, spawn("acme/widgets")).is_empty());
    let wait = std::time::Duration::from_secs(5);
    assert_eq!(
        late.recv_timeout(wait).ok(),
        Some(Event::Spawned {
            id: Some(7),
            workspace_id: "ws-new".into()
        })
    );
    ask(&mut h, spawn("other/repo"));
    assert!(matches!(
        late.recv_timeout(wait),
        Ok(Event::Error { id: Some(7), .. })
    ));
}

#[test]
fn an_oversized_prompt_is_refused() {
    let (mut h, backend, _) = handler();
    let out = ask(
        &mut h,
        Request::Spawn {
            repo: "acme/widgets".into(),
            cli: "claude".into(),
            prompt: Some("x".repeat(MAX_TEXT + 1)),
            title: None,
            cols: 80,
            rows: 24,
        },
    );
    assert!(matches!(&out[..], [Event::Error { .. }]));
    assert!(backend.calls().is_empty());
}

#[test]
fn a_terminal_shell_is_not_served_in_any_request() {
    let (mut h, backend, _) = handler();
    let id = || "term:abc".to_string();
    let requests = [
        Request::Attach {
            workspace_id: id(),
            from_seq: 0,
        },
        Request::Input {
            workspace_id: id(),
            data: "aGk=".into(),
        },
        Request::Resize {
            workspace_id: id(),
            cols: 80,
            rows: 24,
        },
        Request::Stop { workspace_id: id() },
    ];
    for request in requests {
        let out = ask(&mut h, request);
        assert!(matches!(&out[..], [Event::Error { id: Some(7), .. }]));
    }
    assert!(backend.calls().is_empty(), "the backend must not be asked");
}
