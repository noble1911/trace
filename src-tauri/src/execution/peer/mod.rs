//! Another trace as a host, reached over Tailscale. The server is a full trace:
//! worktrees, hooks, agent tools and transcripts all run there as they do
//! locally, and only the screen and keystrokes travel (`protocol`).

pub mod discovery;
pub mod pairing;
pub mod probe;
pub mod protocol;
pub mod settings;
pub mod tailscale;
