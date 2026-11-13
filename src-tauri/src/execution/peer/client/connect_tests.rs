use super::super::testing::{caps, peer, FakeServer};
use super::*;

#[test]
fn hello_carries_the_token_and_returns_the_servers_capabilities() {
    let server = FakeServer::new();
    let (_, got) = open(&server, &peer()).expect("opens");
    assert_eq!(got.name, "box");
    let sent = server.sent();
    assert!(matches!(&sent[0], Request::Hello { protocol, token, .. }
        if *protocol == PROTOCOL_VERSION && token == &peer().token));
}

#[test]
fn a_server_that_isnt_there_is_unreachable_with_a_reason() {
    let server = FakeServer::new();
    server.0.lock().down = true;
    let err = open(&server, &peer()).err().expect("fails");
    assert!(
        err.contains("Can't reach box") && err.contains("timed out"),
        "{err}"
    );
}

#[test]
fn a_refusal_says_to_pair_again_and_never_shows_the_token() {
    let server = FakeServer::new();
    server.0.lock().refuse = Some("Not paired with this trace.".into());
    let err = open(&server, &peer()).err().expect("fails");
    assert!(
        err.contains("refused") && err.contains("Pair again"),
        "{err}"
    );
    assert!(!err.contains(&peer().token));
}

#[test]
fn a_line_that_drops_during_hello_is_a_lost_connection() {
    let server = FakeServer::new();
    server.0.lock().cut = true;
    let err = open(&server, &peer()).err().expect("fails");
    assert!(err.contains("Can't reach") || err.contains("Lost"), "{err}");
}

#[test]
fn a_session_needs_the_agent_the_repo_and_an_open_window() {
    let ok = caps(true);
    assert!(check(&ok, "box", "claude", "acme/widgets").is_ok());
    assert!(check(&ok, "box", "codex", "acme/widgets").is_err());
    assert!(check(&ok, "box", "claude", "other/repo").is_err());
    let closed = check(&caps(false), "box", "claude", "acme/widgets").expect_err("closed");
    assert!(closed.contains("window is closed"), "{closed}");
}
