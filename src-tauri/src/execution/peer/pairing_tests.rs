use super::*;

fn code() -> PairingCode {
    PairingCode {
        address: "100.101.102.103:47821".into(),
        token: new_token(),
    }
}

#[test]
fn tokens_are_fresh_and_well_formed() {
    let (a, b) = (new_token(), new_token());
    assert!(well_formed(&a) && well_formed(&b));
    assert_ne!(a, b);
}

#[test]
fn only_the_exact_token_is_accepted() {
    let token = new_token();
    assert!(accepts(&token, &token));
    assert!(!accepts(&token, &new_token()));
    assert!(!accepts(&token, ""));
    assert!(!accepts(&token, &token[..63]));
}

#[test]
fn a_code_round_trips_and_forgives_whitespace() {
    let code = code();
    let pasted = format!("  {}\n", code.encode());
    assert_eq!(PairingCode::parse(&pasted), Ok(code));
}

#[test]
fn an_ipv6_address_keeps_its_colons() {
    let code = PairingCode {
        address: "[fd7a:115c:a1e0::1]:47821".into(),
        token: new_token(),
    };
    assert_eq!(PairingCode::parse(&code.encode()), Ok(code));
}

#[test]
fn malformed_codes_are_refused() {
    let token = new_token();
    for bad in [
        String::new(),
        "hello".to_string(),
        format!("100.1.1.1:47821/{token}"),
        format!("trace-pair:100.1.1.1/{token}"),
        format!("trace-pair:100.1.1.1:notaport/{token}"),
        format!("trace-pair::47821/{token}"),
        "trace-pair:100.1.1.1:47821/short".to_string(),
    ] {
        assert!(PairingCode::parse(&bad).is_err(), "{bad} parsed");
    }
}

#[test]
fn re_pairing_an_address_keeps_its_id_and_takes_the_new_token() {
    let mut peers = Vec::new();
    let first = upsert(&mut peers, &code(), "mac-mini");
    let again = code();
    let second = upsert(&mut peers, &again, "mac-mini (renamed)");
    assert_eq!(peers.len(), 1);
    assert_eq!(first.id, second.id);
    assert_eq!(peers[0].token, again.token);
}

#[test]
fn the_renderer_summary_has_no_token() {
    let mut peers = Vec::new();
    let summary = upsert(&mut peers, &code(), "mac-mini");
    let json = serde_json::to_value(&summary).expect("serializes");
    assert!(json.get("token").is_none());
}

#[test]
fn tailnet_hosts_are_the_only_ones_a_code_may_name() {
    for ok in [
        "100.64.0.1",
        "100.127.255.254",
        "fd7a:115c:a1e0::1",
        "[fd7a:115c:a1e0::1]",
        "box.tail1.ts.net",
    ] {
        assert!(is_tailnet_host(ok), "{ok}");
    }
    for bad in [
        "100.63.0.1",
        "100.128.0.1",
        "192.168.1.5",
        "example.com",
        "100.64.0.1.evil.com",
        "evil.com#.ts.net",
        "a/b.ts.net",
        "x.ts.net@evil.com",
        "fd7a:115c:a1e0::1/evil",
        "127.0.0.1",
    ] {
        assert!(!is_tailnet_host(bad), "{bad}");
    }
}

#[test]
fn a_code_naming_a_lan_or_public_host_is_refused() {
    let token = new_token();
    for host in [
        "192.168.1.5",
        "10.0.0.2",
        "example.com",
        "127.0.0.1",
        "100.64.0.1.evil.com",
    ] {
        let code = format!("trace-pair:{host}:47821/{token}");
        let err = PairingCode::parse(&code).expect_err(host);
        assert!(err.contains("outside your tailnet"), "{host}: {err}");
    }
    let ok = format!("trace-pair:box.tail1.ts.net:47821/{token}");
    assert!(PairingCode::parse(&ok).is_ok());
}
