//! The "keep this computer awake while agents run" switch, persisted as
//! `keep-awake.json` (`0600`) in the app config dir. Backend-owned because the hold
//! starts with the first agent, whether or not Settings was ever opened. Mirrored in
//! `src/ipc/keepAwake.ts`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::helpers::persist::{self, Style};
use crate::helpers::trace_dir;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
struct KeepAwakeSettings {
    /// On by default: a run that dies with the lid of the machine is worse.
    enabled: bool,
}

impl Default for KeepAwakeSettings {
    fn default() -> Self {
        Self { enabled: true }
    }
}

fn settings_file() -> PathBuf {
    trace_dir().join("keep-awake.json")
}

/// The saved switch; on when none was saved or the file can't be read.
pub fn load() -> bool {
    let saved: KeepAwakeSettings = persist::read_or_log(&settings_file());
    saved.enabled
}

/// Save the switch.
pub fn save(enabled: bool) -> Result<(), String> {
    persist::update(
        &settings_file(),
        Style::Pretty,
        |saved: &mut KeepAwakeSettings| saved.enabled = enabled,
    )
}
