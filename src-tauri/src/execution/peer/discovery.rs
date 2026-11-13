//! Which other traces this one can reach. `tailscale status --json` lists the
//! devices; each online one is probed for the peer port, and every paired peer is
//! probed with its token to learn what it offers. The result is what Settings
//! shows: paired peers always, plus unpaired devices where a trace answered.
//!
//! Tokens stay in here: a [`PeerEntry`] carries none.

use serde::Serialize;

use super::pairing::{PairedPeer, PairingCode, PeerSummary};
use super::probe::{probe, PeerInfo, Probe, Prober, NO_TOKEN, PEER_PORT};
use super::tailscale::Device;

/// Most devices probed at once.
const MAX_PROBES: usize = 16;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PeerState {
    /// Paired, and its server let us in.
    Ready,
    /// Paired, but offline or its server isn't running.
    Away,
    /// Paired, but its server refused our token (it was rotated).
    Refused,
    /// A trace answered on this device and we aren't paired with it.
    Unpaired,
}

/// One peer as the renderer sees it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerEntry {
    /// Set once paired: what `forget` takes.
    pub id: Option<String>,
    pub name: String,
    pub address: String,
    pub os: Option<String>,
    /// Tailscale's word on whether the device is up.
    pub online: bool,
    pub state: PeerState,
    /// What its server offers; only known while `Ready`.
    pub info: Option<PeerInfo>,
}

fn host_of(address: &str) -> &str {
    address
        .rsplit_once(':')
        .map_or(address, |(h, _)| h)
        .trim_matches(|c| c == '[' || c == ']')
}

fn device_for<'a>(devices: &'a [Device], address: &str) -> Option<&'a Device> {
    let host = host_of(address);
    devices
        .iter()
        .find(|d| d.ip.as_deref() == Some(host) || d.dns_name.as_deref() == Some(host))
}

fn paired_entry(p: &PairedPeer, device: Option<&Device>, found: Probe) -> PeerEntry {
    let (state, info) = match found {
        Probe::Welcome(info) => (PeerState::Ready, Some(info)),
        // `Refused` carries no reason a client can rely on, so a protocol-version
        // refusal reads like a changed token ("Pair again") until it does.
        Probe::Refused => (PeerState::Refused, None),
        Probe::Silent => (PeerState::Away, None),
    };
    PeerEntry {
        id: Some(p.id.clone()),
        name: info
            .as_ref()
            .map_or(p.name.clone(), |i| i.host_name.clone()),
        address: p.address.clone(),
        os: info
            .as_ref()
            .and_then(|i| i.os.clone())
            .or_else(|| device.and_then(|d| d.os.clone())),
        online: device.is_some_and(|d| d.online),
        state,
        info,
    }
}

/// Probe everything, in parallel. `devices` are the tailnet's other devices;
/// `client_name` is this machine's, shown on the server.
pub fn discover(
    prober: &dyn Prober,
    devices: &[Device],
    paired: &[PairedPeer],
    client_name: &str,
) -> Vec<PeerEntry> {
    let paired_hosts: Vec<&str> = paired.iter().map(|p| host_of(&p.address)).collect();
    let unpaired: Vec<(&Device, String)> = devices
        .iter()
        .filter(|d| d.online)
        .filter_map(|d| {
            let ip = d.ip.as_deref()?;
            (!paired_hosts.contains(&ip)).then(|| (d, format!("{ip}:{PEER_PORT}")))
        })
        .collect();

    let (mut entries, found) = std::thread::scope(|s| {
        let paired_jobs: Vec<_> = paired
            .iter()
            .map(|p| {
                let device = device_for(devices, &p.address);
                // An offline device can't answer; skip the wait.
                let reachable = device.is_none_or(|d| d.online);
                s.spawn(move || {
                    let found = if reachable {
                        probe(prober, &p.address, &p.token, client_name)
                    } else {
                        Probe::Silent
                    };
                    paired_entry(p, device, found)
                })
            })
            .collect();
        let entries: Vec<PeerEntry> = paired_jobs
            .into_iter()
            .filter_map(|j| j.join().ok())
            .collect();
        // A big tailnet is probed a few at a time, not all at once.
        let mut found = Vec::new();
        for chunk in unpaired.chunks(MAX_PROBES) {
            let jobs: Vec<_> = chunk
                .iter()
                .map(|(d, address)| {
                    s.spawn(move || {
                        (
                            *d,
                            address.clone(),
                            probe(prober, address, NO_TOKEN, client_name),
                        )
                    })
                })
                .collect();
            found.extend(jobs.into_iter().filter_map(|j| j.join().ok()));
        }
        (entries, found)
    });

    for (d, address, answered) in found {
        // A trace refuses an empty token; anything that isn't one stays out of the list.
        if answered == Probe::Refused {
            entries.push(PeerEntry {
                id: None,
                name: d.name.clone(),
                address,
                os: d.os.clone(),
                online: true,
                state: PeerState::Unpaired,
                info: None,
            });
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

/// A host a pairing code may point at: a Tailscale address, so a pasted code can't
/// send a token to a server somewhere else. Any `*.ts.net` name passes, another
/// tailnet's included: the check is "points at Tailscale", not "is my tailnet".
pub fn is_tailnet_host(host: &str) -> bool {
    let host = host
        .trim_matches(|c| c == '[' || c == ']')
        .to_ascii_lowercase();
    if host.ends_with(".ts.net") {
        return host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    }
    if host.starts_with("fd7a:115c:a1e0:") {
        return host.bytes().all(|b| b.is_ascii_hexdigit() || b == b':');
    }
    // 100.64.0.0/10
    let mut parts = host.split('.').map(str::parse::<u8>);
    matches!(
        (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next()
        ),
        (
            Some(Ok(100)),
            Some(Ok(64..=127)),
            Some(Ok(_)),
            Some(Ok(_)),
            None
        )
    )
}

/// Pair from a pasted code: check where it points, let the server vouch for the
/// token, then keep it (`save`). The server's own name is what gets saved.
pub fn pair(
    prober: &dyn Prober,
    code: &str,
    client_name: &str,
    save: impl FnOnce(&PairingCode, &str) -> Result<PeerSummary, String>,
) -> Result<PeerSummary, String> {
    let code = PairingCode::parse(code)?;
    if !is_tailnet_host(host_of(&code.address)) {
        return Err("That code points outside your tailnet, so trace won't use it.".into());
    }
    match probe(prober, &code.address, &code.token, client_name) {
        Probe::Welcome(info) => save(&code, &info.host_name),
        Probe::Refused => Err("That computer refused the code. Copy a fresh one from it.".into()),
        Probe::Silent => Err(
            "Couldn't reach trace on that computer. Is it on, with peer mode switched on?".into(),
        ),
    }
}

#[cfg(test)]
#[path = "discovery_tests.rs"]
mod tests;
