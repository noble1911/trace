//! The peer server's switch and status for Settings. Thin wrapper over
//! `execution::peer::{settings, supervisor}`. The pairing token isn't here: it
//! stays Rust-side until the pairing UI shows it deliberately.

use tauri::State;

use crate::execution::peer::settings;
use crate::execution::peer::supervisor::{PeerServer, ServerStatus};

#[tauri::command]
pub fn peer_server_status(server: State<'_, PeerServer>) -> ServerStatus {
    server.status()
}

/// Turn the server on or off, and/or move it to another port. Returns the status
/// as it was when the supervisor last looked; it looks again at once.
#[tauri::command]
pub fn set_peer_server(
    server: State<'_, PeerServer>,
    enabled: Option<bool>,
    port: Option<u16>,
) -> Result<ServerStatus, String> {
    let saved = settings::update(enabled, port)?;
    eprintln!(
        "trace: peer server: setting is now {} on port {}",
        if saved.enabled { "on" } else { "off" },
        saved.port
    );
    server.wake();
    let mut status = server.status();
    status.enabled = saved.enabled;
    status.port = saved.port;
    Ok(status)
}
