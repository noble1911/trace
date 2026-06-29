//! Claude CLI integration — locate the binary, build its env, and host the
//! interactive TUI inside a PTY. PTY-only by design: headless `-p` mode is
//! being retired, so there is no stream-json transport here.

pub mod discovery;
pub mod env;
pub mod pty;
pub mod render_bridge;
