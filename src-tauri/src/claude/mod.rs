//! Claude CLI integration — locate the binary, build its env, and host the
//! interactive TUI inside a PTY. PTY-only by design: headless `-p` mode is
//! being retired, so there is no stream-json transport here.

pub mod catalog;
pub mod context;
pub mod conversation_log;
pub mod conversations;
pub mod discovery;
pub mod env;
pub mod folder_trust;
pub mod hooks;
pub mod launch;
pub mod permission_ask;
pub mod pty;
pub mod pty_exit;
pub mod pty_output;
pub mod remote_turn;
pub mod render_bridge;
pub mod transcript;
