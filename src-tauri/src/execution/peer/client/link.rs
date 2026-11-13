//! A connection to a peer's server, as the client logic sees it: requests go out
//! and events come in. The real one is a WebSocket (`ws`); tests use a fake, so
//! nothing here needs a listener.

use std::time::Duration;

use crate::execution::peer::protocol::{Event, Request};

/// Why a link couldn't be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    /// Nothing answered: Tailscale is off, the machine is asleep, trace isn't
    /// serving. The text says which step failed.
    Unreachable(String),
    /// It was there and then it wasn't.
    Lost(String),
}

impl std::fmt::Display for LinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LinkError::Unreachable(why) | LinkError::Lost(why) => f.write_str(why),
        }
    }
}

/// One open connection.
pub trait Link: Send {
    fn send(&mut self, request: &Request, id: Option<u64>) -> Result<(), LinkError>;
    /// The next event, or None if nothing came within `wait`.
    fn recv(&mut self, wait: Duration) -> Result<Option<Event>, LinkError>;
    fn close(&mut self);
}

/// Opens links to `address` (`host:port`). A trait so tests supply their own.
pub trait Connector: Send + Sync {
    fn connect(&self, address: &str) -> Result<Box<dyn Link>, LinkError>;
}
