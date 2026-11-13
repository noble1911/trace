//! The server's own settings: whether it listens at all, and on which port.
//! Off until someone turns it on in Settings. Kept apart from the pairing token
//! (`pairing`), which is a secret; nothing here is.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::helpers::persist::{self, Style};
use crate::helpers::trace_dir;

/// Where a trace listens unless told otherwise, so peers can find it by probing
/// each machine on the tailnet for one port.
pub const DEFAULT_PORT: u16 = 47474;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct ServerSettings {
    pub enabled: bool,
    pub port: u16,
}

impl Default for ServerSettings {
    fn default() -> Self {
        ServerSettings {
            enabled: false,
            port: DEFAULT_PORT,
        }
    }
}

fn file() -> PathBuf {
    trace_dir().join("peer-server-settings.json")
}

pub fn load() -> ServerSettings {
    persist::read_or_log(&file())
}

/// Change what's given and save. Port 0 would mean "any", which nobody can find.
pub fn update(enabled: Option<bool>, port: Option<u16>) -> Result<ServerSettings, String> {
    if port == Some(0) {
        return Err("Pick a port above 0.".to_string());
    }
    persist::update(&file(), Style::Pretty, |s: &mut ServerSettings| {
        s.enabled = enabled.unwrap_or(s.enabled);
        s.port = port.unwrap_or(s.port);
        *s
    })
}
