//! This trace's peer settings: whether it serves as a host for other traces.
//! The toggle is only stored here; the server (`peer::server`) reads it.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::helpers::persist::{self, Style};
use crate::helpers::trace_dir;

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Settings {
    server_enabled: bool,
}

fn file() -> PathBuf {
    trace_dir().join("peer-settings.json")
}

/// Whether server mode is on. Off until the user turns it on.
pub fn server_enabled() -> bool {
    persist::read_or_log::<Settings>(&file()).server_enabled
}

pub fn set_server_enabled(on: bool) -> Result<(), String> {
    persist::update(&file(), Style::Pretty, |s: &mut Settings| {
        s.server_enabled = on;
    })
}
