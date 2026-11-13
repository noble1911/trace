//! Other traces on the tailnet: finding them, pairing, forgetting, and this
//! trace's own server switch and pairing code. Thin wrappers over
//! `execution::peer`; probing blocks on the network, so it runs on
//! `spawn_blocking`. Tokens stay in Rust except the one pairing code the user
//! asks to see (`peer_pair_code`), which the renderer shows and never stores.

use crate::execution::peer::discovery::{self, PeerEntry};
use crate::execution::peer::pairing::{self, PairingCode, PeerSummary};
use crate::execution::peer::probe::{WsProber, PEER_PORT};
use crate::execution::peer::settings;
use crate::execution::peer::tailscale::{self, TailnetState};

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("Couldn't reach peers: {e}"))
}

/// This machine's name on the tailnet, which a server shows beside our connection.
fn client_name(status: &tailscale::TailscaleStatus) -> String {
    status
        .device
        .as_ref()
        .map_or_else(|| "trace".to_string(), |d| d.name.clone())
}

/// Paired peers, and unpaired devices where a trace answered, with what each offers.
#[tauri::command]
pub async fn peer_list() -> Result<Vec<PeerEntry>, String> {
    blocking(|| {
        let status = tailscale::status();
        let paired = pairing::paired_peers();
        // Without a tailnet no device can be probed; paired peers still list as away.
        let devices = if status.state == TailnetState::Running {
            status.peers.clone()
        } else {
            Vec::new()
        };
        discovery::discover(&WsProber, &devices, &paired, &client_name(&status))
    })
    .await
}

/// This machine's pairing code, for the user to copy to another machine.
#[tauri::command]
pub async fn peer_pair_code() -> Result<String, String> {
    blocking(|| {
        let ip = tailscale::status()
            .device
            .and_then(|d| d.ip)
            .ok_or("Tailscale isn't connected, so this computer has no tailnet address.")?;
        let token = pairing::server_token()?;
        Ok(PairingCode {
            address: format!("{ip}:{PEER_PORT}"),
            token,
        }
        .encode())
    })
    .await?
}

/// Replace this machine's token, so every code already given out stops working.
#[tauri::command]
pub async fn peer_rotate_token() -> Result<(), String> {
    blocking(|| pairing::rotate_server_token().map(|_| ())).await?
}

/// Pair with another machine from the code it showed.
#[tauri::command]
pub async fn peer_pair(code: String) -> Result<PeerSummary, String> {
    blocking(move || {
        let name = client_name(&tailscale::status());
        discovery::pair(&WsProber, &code, &name, pairing::save_peer)
    })
    .await?
}

/// Forget a paired peer. Its server keeps running and keeps its token.
#[tauri::command]
pub fn peer_forget(id: String) -> Result<(), String> {
    pairing::remove_peer(&id)
}

#[tauri::command]
pub fn get_peer_server() -> bool {
    settings::server_enabled()
}

#[tauri::command]
pub fn set_peer_server(enabled: bool) -> Result<(), String> {
    settings::set_server_enabled(enabled)
}
