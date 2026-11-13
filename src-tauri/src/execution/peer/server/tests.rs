//! The server over a real socket on loopback: a paired client gets served, an
//! unpaired one is refused before anything else is.

use std::net::TcpStream;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use tungstenite::{Message, WebSocket};

use super::testing::{FakeBackend, TOKEN, WRONG_TOKEN};
use super::*;
use crate::execution::peer::hub::Hub;
use crate::execution::peer::protocol::{Envelope, Event, Request, PROTOCOL_VERSION};

type Client = WebSocket<TcpStream>;

struct Rig {
    listener: Listener,
    backend: Arc<FakeBackend>,
    hub: Arc<Hub>,
}

fn rig() -> Rig {
    let backend = Arc::new(FakeBackend::default());
    let hub = Arc::new(Hub::default());
    let shared = Shared {
        backend: backend.clone(),
        hub: hub.clone(),
        stop: Arc::new(AtomicBool::new(false)),
    };
    let listener =
        Listener::start("127.0.0.1:0".parse().expect("addr"), shared).expect("bind loopback");
    Rig {
        listener,
        backend,
        hub,
    }
}

fn connect(rig: &Rig) -> Client {
    let stream = TcpStream::connect(rig.listener.addr()).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("timeout");
    let (ws, _) = tungstenite::client("ws://peer/", stream).expect("handshake");
    ws
}

fn say(ws: &mut Client, id: u64, request: Request) {
    let text = serde_json::to_string(&Envelope {
        id: Some(id),
        request,
    })
    .expect("serializes");
    ws.send(Message::text(text)).expect("send");
}

fn hello(token: &str) -> Request {
    Request::Hello {
        protocol: PROTOCOL_VERSION,
        token: token.into(),
        client_name: "test client".into(),
    }
}

fn hear(ws: &mut Client) -> Option<Event> {
    match ws.read() {
        Ok(Message::Text(t)) => serde_json::from_str(&t).ok(),
        _ => None,
    }
}

fn paired(rig: &Rig) -> Client {
    let mut ws = connect(rig);
    say(&mut ws, 1, hello(TOKEN));
    assert!(matches!(hear(&mut ws), Some(Event::Welcome { .. })));
    ws
}

#[test]
fn a_good_token_gets_a_welcome_with_the_servers_capabilities() {
    let rig = rig();
    let mut ws = connect(&rig);
    say(&mut ws, 1, hello(TOKEN));
    let Some(Event::Welcome { capabilities }) = hear(&mut ws) else {
        panic!("expected a welcome");
    };
    assert_eq!(capabilities.protocol, PROTOCOL_VERSION);
    assert_eq!(capabilities.name, "test-box");
    assert_eq!(capabilities.agents, ["claude"]);
    assert_eq!(capabilities.repos[0].name, "acme/widgets");
    rig.listener.stop();
}

#[test]
fn a_bad_token_is_refused_and_nothing_is_served() {
    let rig = rig();
    let mut ws = connect(&rig);
    say(&mut ws, 1, hello(WRONG_TOKEN));
    assert!(matches!(hear(&mut ws), Some(Event::Refused { .. })));
    // The connection is closed: no more answers, and the backend wasn't touched.
    assert!(hear(&mut ws).is_none());
    assert!(rig.backend.calls().is_empty());
    rig.listener.stop();
}

#[test]
fn a_malformed_token_is_refused_too() {
    let rig = rig();
    let mut ws = connect(&rig);
    say(&mut ws, 1, hello("short"));
    assert!(matches!(hear(&mut ws), Some(Event::Refused { .. })));
    rig.listener.stop();
}

#[test]
fn anything_before_hello_is_refused_without_being_served() {
    let rig = rig();
    let mut ws = connect(&rig);
    say(&mut ws, 1, Request::List);
    assert!(matches!(hear(&mut ws), Some(Event::Refused { .. })));
    assert!(rig.backend.calls().is_empty(), "list must not have run");
    rig.listener.stop();
}

#[test]
fn a_protocol_it_doesnt_speak_is_refused() {
    let rig = rig();
    let mut ws = connect(&rig);
    say(
        &mut ws,
        1,
        Request::Hello {
            protocol: PROTOCOL_VERSION + 1,
            token: TOKEN.into(),
            client_name: "future".into(),
        },
    );
    assert!(matches!(hear(&mut ws), Some(Event::Refused { .. })));
    rig.listener.stop();
}

#[test]
fn a_paired_client_lists_attaches_and_gets_live_output() {
    let rig = rig();
    let mut ws = paired(&rig);
    say(&mut ws, 2, Request::List);
    assert!(matches!(
        hear(&mut ws),
        Some(Event::Sessions { id: Some(2), .. })
    ));
    say(
        &mut ws,
        3,
        Request::Attach {
            workspace_id: "ws1".into(),
            from_seq: 0,
        },
    );
    assert!(matches!(hear(&mut ws), Some(Event::Attached { .. })));
    assert!(matches!(hear(&mut ws), Some(Event::Output { seq: 1, .. })));
    assert!(matches!(hear(&mut ws), Some(Event::Output { seq: 2, .. })));
    rig.hub.publish(&Event::Output {
        workspace_id: "ws1".into(),
        seq: 3,
        data: "Yw==".into(),
    });
    assert!(matches!(hear(&mut ws), Some(Event::Output { seq: 3, .. })));
    rig.listener.stop();
}

#[test]
fn an_unknown_request_is_an_error_not_a_hangup() {
    let rig = rig();
    let mut ws = paired(&rig);
    ws.send(Message::text(r#"{"id":9,"type":"fly"}"#))
        .expect("send");
    assert!(matches!(
        hear(&mut ws),
        Some(Event::Error { id: Some(9), .. })
    ));
    say(&mut ws, 10, Request::List);
    assert!(matches!(hear(&mut ws), Some(Event::Sessions { .. })));
    rig.listener.stop();
}

#[test]
fn stopping_the_listener_hangs_up_clients_and_frees_the_port() {
    let rig = rig();
    let mut ws = paired(&rig);
    let addr = rig.listener.addr();
    rig.listener.stop();
    assert!(hear(&mut ws).is_none(), "the client is hung up on");
    assert!(
        std::net::TcpListener::bind(addr).is_ok(),
        "the port is free again"
    );
}

#[test]
fn only_tailscale_addresses_can_be_listened_on() {
    assert!(tailnet_ip("100.64.0.1").is_ok());
    assert!(tailnet_ip("100.127.255.254").is_ok());
    for bad in [
        "0.0.0.0",
        "127.0.0.1",
        "192.168.1.5",
        "100.128.0.1",
        "100.63.0.1",
        "fd7a::1",
        "",
    ] {
        assert!(tailnet_ip(bad).is_err(), "{bad} must be refused");
    }
}

#[test]
fn rotating_the_token_hangs_up_a_connection_paired_with_the_old_one() {
    let rig = rig();
    let mut ws = paired(&rig);
    say(&mut ws, 2, Request::List);
    assert!(matches!(hear(&mut ws), Some(Event::Sessions { .. })));
    rig.backend.rotate();
    // The very next request is refused, not served, and the connection ends.
    say(&mut ws, 3, Request::List);
    assert!(matches!(hear(&mut ws), Some(Event::Refused { .. })));
    assert!(hear(&mut ws).is_none());
    assert_eq!(
        rig.backend.calls(),
        ["list"],
        "the second list must not have run"
    );
    rig.listener.stop();
}

#[test]
fn an_idle_connection_is_dropped_soon_after_the_token_is_rotated() {
    let rig = rig();
    let mut ws = paired(&rig);
    rig.backend.rotate();
    assert!(matches!(hear(&mut ws), Some(Event::Refused { .. })));
    rig.listener.stop();
}

#[test]
fn the_old_token_no_longer_gets_in_after_a_rotation() {
    let rig = rig();
    rig.backend.rotate();
    let mut ws = connect(&rig);
    say(&mut ws, 1, hello(TOKEN));
    assert!(matches!(hear(&mut ws), Some(Event::Refused { .. })));
    let mut ws = connect(&rig);
    say(&mut ws, 1, hello(WRONG_TOKEN));
    assert!(matches!(hear(&mut ws), Some(Event::Welcome { .. })));
    rig.listener.stop();
}
