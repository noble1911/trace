use std::collections::HashMap;

use super::*;
use crate::execution::peer::probe::classify;

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/// Servers by address, each with the token it accepts. Anything else is silent.
struct Fake(HashMap<&'static str, &'static str>);

impl Prober for Fake {
    fn exchange(&self, address: &str, hello: &str) -> Result<String, String> {
        let want = self.0.get(address).ok_or("no answer")?;
        let v: serde_json::Value = serde_json::from_str(hello).map_err(|e| e.to_string())?;
        assert_eq!(v["type"], "hello");
        if v["token"] == *want {
            Ok(
                r#"{"type":"welcome","capabilities":{"protocol":1,"name":"Mac mini","os":"macos",
                "agents":["claude","codex"],"repos":[{"name":"acme/widgets","remote":"github.com/acme/widgets"}],
                "features":{"turnHooks":true,"terminal":true}}}"#
                    .to_string(),
            )
        } else {
            Ok(r#"{"type":"refused","reason":"bad token"}"#.to_string())
        }
    }
}

fn device(name: &str, ip: &str, online: bool) -> Device {
    Device {
        name: name.into(),
        dns_name: None,
        ip: Some(ip.into()),
        os: Some("linux".into()),
        online,
    }
}

fn paired(address: &str, token: &str) -> PairedPeer {
    PairedPeer {
        id: "p1".into(),
        name: "old name".into(),
        address: address.into(),
        token: token.into(),
    }
}

#[test]
fn welcome_carries_capabilities_kinds_and_repos() {
    let Probe::Welcome(info) = classify(
        r#"{"type":"welcome","capabilities":{"protocol":1,"name":"Mac mini","os":"macos",
            "agents":["claude"],"repos":[{"name":"acme/widgets"}],"features":{"terminal":true}}}"#,
    ) else {
        panic!("not a welcome");
    };
    assert_eq!(info.host_name, "Mac mini");
    assert!(info.capabilities.terminal && !info.capabilities.files);
    assert_eq!(info.agent_kinds, ["claude"]);
    assert_eq!(info.repos, ["acme/widgets"]);
}

#[test]
fn an_older_welcome_without_the_extras_still_reads() {
    let Probe::Welcome(info) = classify(r#"{"type":"welcome","capabilities":{"name":"x"}}"#) else {
        panic!("not a welcome");
    };
    assert!(info.agent_kinds.is_empty() && info.repos.is_empty() && info.os.is_none());
}

#[test]
fn other_answers_are_silence() {
    assert_eq!(classify("not json"), Probe::Silent);
    assert_eq!(
        classify(r#"{"type":"sessions","sessions":[]}"#),
        Probe::Silent
    );
    assert_eq!(
        classify(r#"{"type":"refused","reason":"no"}"#),
        Probe::Refused
    );
}

#[test]
fn only_online_devices_that_answer_like_a_trace_are_listed() {
    let fake = Fake(HashMap::from([("100.64.0.2:47821", TOKEN)]));
    let devices = [
        device("mac-mini", "100.64.0.2", true),
        device("printer", "100.64.0.3", true),
        device("zed-box", "100.64.0.9", false),
    ];
    let found = discover(&fake, &devices, &[], "me");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].name, "mac-mini");
    assert_eq!(found[0].state, PeerState::Unpaired);
    assert_eq!(found[0].address, "100.64.0.2:47821");
    assert!(found[0].id.is_none() && found[0].info.is_none());
}

#[test]
fn a_paired_peer_shows_what_its_server_offers() {
    let fake = Fake(HashMap::from([("100.64.0.2:47821", TOKEN)]));
    let devices = [device("mac-mini", "100.64.0.2", true)];
    let found = discover(&fake, &devices, &[paired("100.64.0.2:47821", TOKEN)], "me");
    assert_eq!(found.len(), 1);
    let p = &found[0];
    assert_eq!((p.state, p.online), (PeerState::Ready, true));
    assert_eq!(p.name, "Mac mini");
    assert_eq!(p.id.as_deref(), Some("p1"));
    let info = p.info.as_ref().expect("info");
    assert_eq!(info.repos, ["acme/widgets"]);
}

#[test]
fn paired_peers_stay_listed_when_offline_or_refused() {
    let fake = Fake(HashMap::from([(
        "100.64.0.2:47821",
        "f".repeat(64).leak() as &str,
    )]));
    let devices = [
        device("mac-mini", "100.64.0.2", true),
        device("zed-box", "100.64.0.9", false),
    ];
    let peers = [
        paired("100.64.0.2:47821", TOKEN),
        PairedPeer {
            id: "p2".into(),
            ..paired("100.64.0.9:47821", TOKEN)
        },
        PairedPeer {
            id: "p3".into(),
            ..paired("100.64.0.77:47821", TOKEN)
        },
    ];
    let found = discover(&fake, &devices, &peers, "me");
    let state = |id: &str| {
        found
            .iter()
            .find(|p| p.id.as_deref() == Some(id))
            .map(|p| p.state)
    };
    assert_eq!(state("p1"), Some(PeerState::Refused));
    assert_eq!(state("p2"), Some(PeerState::Away));
    assert_eq!(state("p3"), Some(PeerState::Away));
}

#[test]
fn entries_never_carry_a_token() {
    let fake = Fake(HashMap::from([("100.64.0.2:47821", TOKEN)]));
    let devices = [device("mac-mini", "100.64.0.2", true)];
    let found = discover(&fake, &devices, &[paired("100.64.0.2:47821", TOKEN)], "me");
    let json = serde_json::to_string(&found).unwrap_or_default();
    assert!(!json.contains(TOKEN));
}

fn saved(_: &PairingCode, name: &str) -> Result<PeerSummary, String> {
    Ok(PeerSummary {
        id: "new".into(),
        name: name.into(),
        address: String::new(),
    })
}

#[test]
fn pairing_saves_the_server_name_once_it_accepts_the_token() {
    let fake = Fake(HashMap::from([("100.64.0.2:47821", TOKEN)]));
    let code = format!("trace-pair:100.64.0.2:47821/{TOKEN}");
    let got = pair(&fake, &code, "me", saved).expect("paired");
    assert_eq!(got.name, "Mac mini");
}

#[test]
fn pairing_says_why_it_failed() {
    let fake = Fake(HashMap::from([(
        "100.64.0.2:47821",
        "f".repeat(64).leak() as &str,
    )]));
    let refused = pair(
        &fake,
        &format!("trace-pair:100.64.0.2:47821/{TOKEN}"),
        "me",
        saved,
    );
    assert!(refused.expect_err("refused").contains("refused"));
    let silent = pair(
        &fake,
        &format!("trace-pair:100.64.0.5:47821/{TOKEN}"),
        "me",
        saved,
    );
    assert!(silent.expect_err("silent").contains("Couldn't reach"));
    let outside = pair(
        &fake,
        &format!("trace-pair:192.168.1.5:47821/{TOKEN}"),
        "me",
        saved,
    );
    assert!(outside
        .expect_err("outside")
        .contains("outside your tailnet"));
    assert!(pair(&fake, "hello", "me", saved).is_err());
}
