//! Another trace as a host, reached over Tailscale. The server is a full trace:
//! worktrees, hooks, agent tools and transcripts all run there as they do
//! locally, and only the screen and keystrokes travel (`protocol`).

pub mod app_backend;
pub mod backend;
pub mod capabilities;
<<<<<<< HEAD
pub mod discovery;
=======
pub mod client;
>>>>>>> 79168c5 (Peer client: PeerHost, a remote terminal session, rejoin, and start_session on a peer)
pub mod hub;
pub mod pairing;
pub mod probe;
pub mod protocol;
pub mod publish;
pub mod server;
pub mod settings;
pub mod supervisor;
pub mod tailscale;
