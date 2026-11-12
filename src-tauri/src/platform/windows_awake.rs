//! The Windows adapter for keeping the computer awake.

use windows_sys::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
};

use super::ports::{SleepHold, SleepInhibitor};
use super::Os;

impl SleepInhibitor for Os {
    /// `ES_SYSTEM_REQUIRED` holds the system awake without keeping the display on. The
    /// request belongs to the calling thread and ends with it, so it's undone from the
    /// same thread (`SleepHold`'s contract); `ES_CONTINUOUS` alone clears it.
    fn hold() -> Option<SleepHold> {
        // SAFETY: a plain call that only sets the calling thread's execution state.
        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
        Some(SleepHold::new(|| {
            // SAFETY: as above.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        }))
    }
}
