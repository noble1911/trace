//! What the peer server is doing, for Settings. The on/off switch itself is
//! `commands::peers::set_peer_server`; the supervisor notices it within its poll.
//! The pairing token isn't here: it stays Rust-side.

use tauri::State;

use crate::execution::peer::supervisor::{PeerServer, ServerStatus};

#[tauri::command]
pub fn peer_server_status(server: State<'_, PeerServer>) -> ServerStatus {
    server.status()
}
