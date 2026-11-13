use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;

use parking_lot::Mutex;

use super::super::testing::{b64, caps, peer, FakeServer};
use super::*;

#[derive(Default)]
struct Seen {
    screen: Vec<u8>,
    lines: Vec<String>,
    spawned: Option<String>,
    forgot: bool,
    turns: usize,
    begins: Vec<(u16, u16)>,
}

#[derive(Clone, Default)]
struct RecSink(Arc<Mutex<Seen>>);

impl Sink for RecSink {
    fn begin(&self, cols: u16, rows: u16) {
        self.0.lock().begins.push((cols, rows));
    }
    fn output(&self, bytes: &[u8]) -> bool {
        self.0.lock().screen.extend_from_slice(bytes);
        true
    }
    fn say(&self, line: &str) {
        self.0.lock().lines.push(line.to_string());
    }
    fn fail(&self, line: &str) {
        self.0.lock().lines.push(format!("FAIL {line}"));
    }
    fn turn(&self, _: &Event) {
        self.0.lock().turns += 1;
    }
    fn spawned(&self, id: &str) {
        self.0.lock().spawned = Some(id.to_string());
    }
    fn forget(&self) {
        self.0.lock().forgot = true;
    }
}

fn plan(remote_id: Option<&str>) -> Plan {
    Plan {
        peer: peer(),
        repo: "acme/widgets".into(),
        remote_id: remote_id.map(str::to_string),
        cli: "claude".into(),
        prompt: Some("fix the bug".into()),
        title: Some("Fix".into()),
        cols: 90,
        rows: 20,
    }
}

fn output(ws: &str, text: &str) -> Event {
    Event::Output {
        workspace_id: ws.into(),
        seq: 1,
        data: b64(text),
    }
}

/// Run a plan on its own thread until `done` says it can end, then drop the
/// command channel (a detach) and return how it ended.
fn drive(
    server: &FakeServer,
    plan: Plan,
    sink: &RecSink,
    cmds: impl FnOnce(&Sender<Cmd>),
) -> Ended {
    let (tx, rx) = channel();
    let (srv, snk) = (server.clone(), sink.clone());
    let handle = std::thread::spawn(move || run(&srv, &plan, &snk, &rx));
    cmds(&tx);
    drop(tx);
    handle.join().expect("the session thread")
}

#[test]
fn a_new_session_spawns_remembers_its_id_attaches_and_shows_the_screen() {
    let server = FakeServer::new();
    server.on_attach(output("ws-remote", "hello from the peer"));
    let sink = RecSink::default();
    let ended = drive(&server, plan(None), &sink, |_| {
        std::thread::sleep(Duration::from_millis(150));
    });
    // The command channel closed when `tx` went out of scope: a detach.
    assert_eq!(ended, Ended::Detached);
    let seen = sink.0.lock();
    assert_eq!(seen.spawned.as_deref(), Some("ws-remote"));
    assert_eq!(String::from_utf8_lossy(&seen.screen), "hello from the peer");
    let sent = server.sent();
    assert!(matches!(&sent[1], Request::Spawn { repo, cli, prompt, .. }
        if repo == "acme/widgets" && cli == "claude" && prompt.as_deref() == Some("fix the bug")));
    assert!(
        matches!(&sent[2], Request::Attach { workspace_id, from_seq: 0 } if workspace_id == "ws-remote")
    );
    assert!(
        matches!(
            &sent[3],
            Request::Resize {
                cols: 90,
                rows: 20,
                ..
            }
        ),
        "our size wins"
    );
}

#[test]
fn rejoining_attaches_to_the_remembered_session_without_spawning() {
    let server = FakeServer::new();
    server.0.lock().sessions = vec!["ws-remote".into()];
    let sink = RecSink::default();
    let ended = drive(&server, plan(Some("ws-remote")), &sink, |_| {});
    assert_eq!(ended, Ended::Detached);
    let sent = server.sent();
    assert!(
        !sent.iter().any(|r| matches!(r, Request::Spawn { .. })),
        "no second agent"
    );
    assert!(sent.iter().any(|r| matches!(r, Request::Attach { workspace_id, from_seq: 0 } if workspace_id == "ws-remote")));
    assert_eq!(sink.0.lock().spawned, None);
}

#[test]
fn a_prompt_for_a_rejoined_session_is_typed_into_it() {
    let server = FakeServer::new();
    server.0.lock().sessions = vec!["ws-remote".into()];
    let sink = RecSink::default();
    drive(&server, plan(Some("ws-remote")), &sink, |_| {});
    let typed = server.sent().into_iter().find_map(|r| match r {
        Request::Input { data, .. } => Some(data),
        _ => None,
    });
    assert_eq!(typed, Some(b64("fix the bug\r")));
}

#[test]
fn a_session_the_peer_no_longer_has_is_forgotten_not_respawned() {
    let server = FakeServer::new();
    let sink = RecSink::default();
    let ended = drive(&server, plan(Some("ws-old")), &sink, |_| {});
    assert_eq!(ended, Ended::Failed);
    let seen = sink.0.lock();
    assert!(seen.forgot);
    assert!(seen
        .lines
        .iter()
        .any(|l| l.contains("isn't running on box")));
    assert!(!server
        .sent()
        .iter()
        .any(|r| matches!(r, Request::Spawn { .. })));
}

#[test]
fn an_unreachable_peer_says_so_in_the_terminal_and_ends() {
    let server = FakeServer::new();
    server.0.lock().down = true;
    let sink = RecSink::default();
    assert_eq!(drive(&server, plan(None), &sink, |_| {}), Ended::Failed);
    let lines = sink.0.lock().lines.join("\n");
    assert!(lines.contains("FAIL Can't reach box"), "{lines}");
}

#[test]
fn a_closed_server_window_refuses_before_anything_is_asked_to_run() {
    let server = FakeServer::new();
    server.0.lock().caps = Some(caps(false));
    let sink = RecSink::default();
    assert_eq!(drive(&server, plan(None), &sink, |_| {}), Ended::Failed);
    assert!(sink.0.lock().lines.join("\n").contains("window is closed"));
    assert!(!server
        .sent()
        .iter()
        .any(|r| matches!(r, Request::Spawn { .. })));
}

#[test]
fn a_refused_spawn_shows_the_peers_reason() {
    let server = FakeServer::new();
    server.0.lock().spawns_as = None;
    let sink = RecSink::default();
    assert_eq!(drive(&server, plan(None), &sink, |_| {}), Ended::Failed);
    assert!(sink
        .0
        .lock()
        .lines
        .join("\n")
        .contains("isn't on this trace"));
}

#[test]
fn keystrokes_resizes_and_stop_travel_as_requests() {
    let server = FakeServer::new();
    let sink = RecSink::default();
    let ended = drive(&server, plan(None), &sink, |tx| {
        tx.send(Cmd::Input(b"hi".to_vec())).expect("input");
        tx.send(Cmd::Resize(120, 40)).expect("resize");
        tx.send(Cmd::Stop).expect("stop");
    });
    assert_eq!(ended, Ended::Stopped);
    let sent = server.sent();
    assert!(sent
        .iter()
        .any(|r| matches!(r, Request::Input { data, .. } if data == &b64("hi"))));
    assert!(sent.iter().any(|r| matches!(
        r,
        Request::Resize {
            cols: 120,
            rows: 40,
            ..
        }
    )));
    assert!(
        matches!(sent.last(), Some(Request::Stop { workspace_id }) if workspace_id == "ws-remote")
    );
}

#[test]
fn the_agent_ending_ends_the_run_and_turns_are_passed_on() {
    let server = FakeServer::new();
    server.on_attach(Event::Turn {
        workspace_id: "ws-remote".into(),
        event: "stop".into(),
        background_tasks: 0,
        notification_type: None,
        message: None,
        last_message: None,
    });
    server.on_attach(Event::RunState {
        workspace_id: "ws-remote".into(),
        running: false,
        exited: true,
    });
    let sink = RecSink::default();
    let (_keep, rx) = channel();
    let ended = run(&server, &plan(None), &sink, &rx);
    assert_eq!(ended, Ended::Exited);
    assert_eq!(sink.0.lock().turns, 1);
}

#[test]
fn a_dropped_line_is_lost_with_the_rejoin_hint() {
    let server = FakeServer::new();
    let sink = RecSink::default();
    let ended = drive(&server, plan(None), &sink, |_| {
        std::thread::sleep(Duration::from_millis(100));
        server.0.lock().cut = true;
        std::thread::sleep(Duration::from_millis(100));
    });
    assert_eq!(ended, Ended::Lost);
    assert!(sink.0.lock().lines.join("\n").contains("Start rejoins it"));
}

#[test]
fn neither_the_token_nor_the_prompt_appears_in_anything_said() {
    let server = FakeServer::new();
    server.0.lock().spawns_as = None;
    let sink = RecSink::default();
    drive(&server, plan(None), &sink, |_| {});
    let lines = sink.0.lock().lines.join("\n");
    assert!(!lines.contains(&peer().token) && !lines.contains("fix the bug"));
}
