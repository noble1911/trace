use super::*;
use crate::execution::peer::client::testing::{peer as fake_peer, FakeServer, TOKEN};

fn paired() -> Vec<PairedPeer> {
    let p = fake_peer();
    vec![PairedPeer {
        id: p.id,
        name: p.name,
        address: p.address,
        token: TOKEN.into(),
    }]
}

#[test]
fn a_peer_choice_carries_the_paired_id() {
    assert_eq!(peer_id("peer:abc"), Some("abc"));
    assert_eq!(peer_id("vercel"), None);
    assert_eq!(peer_id("local"), None);
}

#[test]
fn an_unpaired_peer_is_refused_with_a_reason() {
    let server = FakeServer::new();
    let err = vet(&server, &paired(), "nobody", "acme/widgets", "claude").expect_err("unpaired");
    assert!(err.contains("isn't paired"), "{err}");
    assert!(server.sent().is_empty(), "nothing was sent to anyone");
}

#[test]
fn an_unreachable_peer_is_refused_with_a_reason() {
    let server = FakeServer::new();
    server.0.lock().down = true;
    let err = vet(&server, &paired(), "p1", "acme/widgets", "claude").expect_err("down");
    assert!(err.contains("Can't reach box"), "{err}");
}

#[test]
fn a_peer_with_its_window_closed_is_refused_without_starting_anything() {
    let server = FakeServer::new();
    server.0.lock().caps = Some(crate::execution::peer::client::testing::caps(false));
    let err = vet(&server, &paired(), "p1", "acme/widgets", "claude").expect_err("closed");
    assert!(err.contains("window is closed"), "{err}");
    let sent = server.sent();
    assert!(sent
        .iter()
        .all(|r| matches!(r, crate::execution::peer::protocol::Request::Hello { .. })));
}

#[test]
fn a_good_peer_gives_a_host_with_no_remote_session_yet() {
    let server = FakeServer::new();
    let host = vet(&server, &paired(), "p1", "acme/widgets", "claude").expect("ok");
    assert_eq!(
        host,
        SessionHost::Peer {
            peer: "p1".into(),
            repo: "acme/widgets".into(),
            remote_id: None
        }
    );
}

#[test]
fn the_record_shape_is_what_the_renderer_reads() {
    let host = SessionHost::Peer {
        peer: "p1".into(),
        repo: "acme/widgets".into(),
        remote_id: Some("ws9".into()),
    };
    let json = serde_json::to_value(&host).expect("serializes");
    assert_eq!(json["kind"], "peer");
    assert_eq!(json["remoteId"], "ws9");
    assert_eq!(json["repo"], "acme/widgets");
}

#[test]
fn an_agent_can_name_a_peer_by_its_name_if_that_is_unambiguous() {
    let mut peers = paired();
    assert_eq!(find(&peers, "BOX").expect("by name").id, "p1");
    peers.extend(paired().into_iter().map(|mut p| {
        p.id = "p2".into();
        p
    }));
    assert!(find(&peers, "box").is_err(), "two peers share the name");
    assert_eq!(find(&peers, "p2").expect("by id").id, "p2");
}
