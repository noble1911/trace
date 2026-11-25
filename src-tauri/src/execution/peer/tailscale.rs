//! What Tailscale says about this machine's tailnet: whether it's installed and
//! running, this device, and the others on the tailnet (the traces a peer host
//! can reach). Read from `tailscale status --json`, found through tool discovery
//! like `git` and `gh`. Nothing here needs a Tailscale key: the local daemon
//! answers its own user.

use serde::Serialize;
use serde_json::Value;

/// Where Tailscale is on this machine.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TailnetState {
    NotInstalled,
    /// Installed, but not connected (switched off, or its daemon isn't up).
    Stopped,
    NeedsLogin,
    Running,
}

/// One device on the tailnet.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub name: String,
    /// Its MagicDNS name, e.g. `devs-macbook.tail1234.ts.net`.
    pub dns_name: Option<String>,
    /// Its IPv4 tailnet address, which a peer server binds to.
    pub ip: Option<String>,
    pub os: Option<String>,
    pub online: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleStatus {
    pub state: TailnetState,
    /// The tailnet's name (a personal one is named after its owner's login).
    pub tailnet: Option<String>,
    /// This machine.
    pub device: Option<Device>,
    /// Every other device, online ones first.
    pub peers: Vec<Device>,
}

impl TailscaleStatus {
    fn bare(state: TailnetState) -> TailscaleStatus {
        TailscaleStatus {
            state,
            tailnet: None,
            device: None,
            peers: Vec::new(),
        }
    }
}

fn text(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

fn device(v: &Value) -> Device {
    let ips = v["TailscaleIPs"].as_array();
    Device {
        name: text(&v["HostName"]).unwrap_or_else(|| "Unnamed device".to_string()),
        dns_name: text(&v["DNSName"]).map(|d| d.trim_end_matches('.').to_string()),
        ip: ips
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .find(|ip| ip.contains('.'))
            .map(str::to_string),
        os: text(&v["OS"]),
        online: v["Online"].as_bool().unwrap_or(false),
    }
}

/// Read `tailscale status --json`.
pub fn parse(json: &str) -> TailscaleStatus {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return TailscaleStatus::bare(TailnetState::Stopped);
    };
    let state = match v["BackendState"].as_str() {
        Some("Running") => TailnetState::Running,
        Some("NeedsLogin" | "NeedsMachineAuth") => TailnetState::NeedsLogin,
        _ => TailnetState::Stopped,
    };
    let mut peers: Vec<Device> = v["Peer"]
        .as_object()
        .into_iter()
        .flat_map(|peers| peers.values())
        .map(device)
        .collect();
    peers.sort_by(|a, b| b.online.cmp(&a.online).then(a.name.cmp(&b.name)));
    TailscaleStatus {
        state,
        tailnet: text(&v["CurrentTailnet"]["Name"]),
        device: v.get("Self").filter(|s| s.is_object()).map(device),
        peers,
    }
}

/// Ask this machine's Tailscale. Blocking: it runs the CLI.
pub fn status() -> TailscaleStatus {
    if crate::claude::discovery::find_cli_with_env("tailscale", None).is_none() {
        return TailscaleStatus::bare(TailnetState::NotInstalled);
    }
    match crate::claude::discovery::command("tailscale")
        .args(["status", "--json"])
        .output()
    {
        // It exits non-zero when stopped or logged out, yet still prints JSON.
        Ok(out) => parse(&String::from_utf8_lossy(&out.stdout)),
        Err(_) => TailscaleStatus::bare(TailnetState::NotInstalled),
    }
}

impl TailscaleStatus {
    /// The name of the device on this tailnet at `ip`. A peer server names who
    /// started a session by it: Tailscale vouches for the address, where the
    /// client's own `hello` name is whatever it says.
    pub fn device_at(&self, ip: &str) -> Option<&str> {
        self.peers
            .iter()
            .chain(self.device.as_ref())
            .find(|d| d.ip.as_deref() == Some(ip))
            .map(|d| d.name.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUNNING: &str = r#"{
        "BackendState": "Running",
        "CurrentTailnet": { "Name": "dev@example.com", "MagicDNSSuffix": "tail1234.ts.net" },
        "Self": { "HostName": "Dev’s MacBook", "DNSName": "devs-macbook.tail1234.ts.net.",
                  "TailscaleIPs": ["fd7a:115c:a1e0::1", "100.64.0.1"], "OS": "macOS", "Online": true },
        "Peer": {
            "a": { "HostName": "zed-box", "TailscaleIPs": ["100.64.0.9"], "OS": "linux", "Online": false },
            "b": { "HostName": "mac-mini", "TailscaleIPs": ["100.64.0.2"], "OS": "macOS", "Online": true }
        }
    }"#;

    #[test]
    fn a_running_tailnet_lists_this_device_and_the_others() {
        let s = parse(RUNNING);
        assert_eq!(s.state, TailnetState::Running);
        assert_eq!(s.tailnet.as_deref(), Some("dev@example.com"));
        let me = s.device.expect("this device");
        assert_eq!(me.ip.as_deref(), Some("100.64.0.1"));
        assert_eq!(me.dns_name.as_deref(), Some("devs-macbook.tail1234.ts.net"));
        let names: Vec<&str> = s.peers.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["mac-mini", "zed-box"]);
    }

    #[test]
    fn a_device_is_found_by_its_address() {
        let s = parse(RUNNING);
        assert_eq!(s.device_at("100.64.0.2"), Some("mac-mini"));
        assert_eq!(s.device_at("100.64.0.1"), Some("Dev’s MacBook"));
        assert_eq!(s.device_at("100.64.0.77"), None);
    }

    #[test]
    fn logged_out_and_stopped_read_as_such() {
        assert_eq!(
            parse(r#"{"BackendState":"NeedsLogin"}"#).state,
            TailnetState::NeedsLogin
        );
        assert_eq!(
            parse(r#"{"BackendState":"Stopped"}"#).state,
            TailnetState::Stopped
        );
        assert_eq!(
            parse("failed to connect to local tailscaled").state,
            TailnetState::Stopped
        );
    }

    #[test]
    fn states_reach_the_renderer_in_camel_case() {
        let json = serde_json::to_value(TailnetState::NotInstalled).unwrap_or_default();
        assert_eq!(json, "notInstalled");
    }
}
