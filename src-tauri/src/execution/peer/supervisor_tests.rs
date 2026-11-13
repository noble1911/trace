use super::*;
use crate::execution::peer::tailscale::{Device, TailscaleStatus};

fn addr(s: &str) -> SocketAddr {
    s.parse().expect("addr")
}

fn on(ip: Option<&str>, state: TailnetState) -> TailscaleStatus {
    TailscaleStatus {
        state,
        tailnet: None,
        device: Some(Device {
            name: "box".into(),
            dns_name: None,
            ip: ip.map(str::to_string),
            os: None,
            online: true,
        }),
        peers: vec![],
    }
}

const ENABLED: ServerSettings = ServerSettings {
    enabled: true,
    port: 47474,
};

#[test]
fn it_listens_on_the_tailscale_ip_and_the_settings_port() {
    let (w, name) = want(&ENABLED, || on(Some("100.64.0.1"), TailnetState::Running));
    assert_eq!(w, Want::Listen(addr("100.64.0.1:47474")));
    assert_eq!(name, "box");
}

#[test]
fn switched_off_it_never_asks_tailscale() {
    let off = ServerSettings {
        enabled: false,
        ..ENABLED
    };
    let (w, _) = want(&off, || panic!("must not run the tailscale CLI"));
    assert!(matches!(w, Want::Not(_)));
}

#[test]
fn tailscale_down_or_without_an_address_means_not_listening() {
    for state in [
        TailnetState::Stopped,
        TailnetState::NeedsLogin,
        TailnetState::NotInstalled,
    ] {
        let (w, _) = want(&ENABLED, || on(Some("100.64.0.1"), state));
        assert!(matches!(w, Want::Not(_)), "{state:?}");
    }
    let (w, _) = want(&ENABLED, || on(None, TailnetState::Running));
    assert!(matches!(w, Want::Not(_)));
}

#[test]
fn an_address_outside_the_tailnet_is_never_bound() {
    let (w, _) = want(&ENABLED, || on(Some("192.168.1.9"), TailnetState::Running));
    assert!(matches!(w, Want::Not(_)));
}

#[test]
fn it_follows_tailscale_going_and_the_ip_changing() {
    let a = addr("100.64.0.1:47474");
    let b = addr("100.64.0.2:47474");
    let down = Want::Not("Tailscale is off".into());
    assert_eq!(decide(None, &Want::Listen(a)), Step::Start(a));
    assert_eq!(decide(Some(a), &Want::Listen(a)), Step::Keep);
    assert_eq!(decide(Some(a), &down), Step::Stop(a, None));
    assert_eq!(decide(None, &down), Step::Idle);
    assert_eq!(decide(Some(a), &Want::Listen(b)), Step::Stop(a, Some(b)));
}
