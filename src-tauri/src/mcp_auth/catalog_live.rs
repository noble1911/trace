//! Every server in trace's list, checked live (`cargo test mcp_live_catalog --
//! --ignored --nocapture`): an OAuth one must be discoverable and let trace
//! register itself (Connect needs no setup), an open one must answer MCP's
//! `initialize` without a login, a keyed one must refuse a call without its key.
//! Run it when the list changes, and now and then: services move their servers.

use super::catalog::{Auth, Known, CATALOG};

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent("trace")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .expect("http client")
}

/// The HTTP status of MCP's `initialize`, sent with no login.
fn initialize(url: &str) -> Result<u16, String> {
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": { "name": "trace", "version": "0" } },
    });
    client()
        .post(url)
        .header("Accept", "application/json, text/event-stream")
        .json(&body)
        .send()
        .map(|r| r.status().as_u16())
        .map_err(|e| e.to_string())
}

/// What's wrong with `k`'s server, if anything.
fn check(k: &Known) -> Result<String, String> {
    match k.auth {
        Auth::Oauth => {
            let d = super::oauth::discover(k.url)?;
            if d.registration_endpoint.is_none() {
                return Err(format!(
                    "{} can't register trace: Connect would ask for a client ID",
                    d.issuer
                ));
            }
            Ok(format!("oauth  issuer {}", d.issuer))
        }
        Auth::Open => match initialize(k.url)? {
            200..=299 => Ok("open   answers without a login".into()),
            code => Err(format!("open, but initialize got HTTP {code}")),
        },
        Auth::Key => match initialize(k.url)? {
            401 | 403 => Ok("key    refuses a call without its key".into()),
            code => Err(format!("keyed, but a call without a key got HTTP {code}")),
        },
    }
}

#[test]
#[ignore = "reaches every server in trace's list"]
fn mcp_live_catalog_every_server_connects_as_listed() {
    let mut broken = Vec::new();
    for k in CATALOG {
        match check(k) {
            Ok(how) => println!("ok   {:16} {how}", k.name),
            Err(e) => {
                println!("FAIL {:16} {e}", k.name);
                broken.push(k.name);
            }
        }
    }
    assert!(broken.is_empty(), "not connectable as listed: {broken:?}");
}
