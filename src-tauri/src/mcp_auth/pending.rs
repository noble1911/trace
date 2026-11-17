//! The one browser login trace is waiting on. Every login listens on the same
//! fixed loopback port (`oauth::REDIRECT_PORT`), so a login whose browser half
//! never comes back (a wrong client id, a server that refused on its own page
//! and never redirected) would hold that port until its deadline, and every
//! retry would fail with "port busy". Instead there is one slot: a new login
//! takes it over (cancelling the one before, which frees the port), and the
//! user can cancel it outright (`mcp_cancel_login`, or closing the dialog).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

/// What a cancelled login fails with. The renderer knows it (`src/ipc/mcp.ts`)
/// and says nothing: the user asked for it.
pub const CANCELLED: &str = "login-cancelled";

static WAITING: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

fn slot() -> MutexGuard<'static, Option<Arc<AtomicBool>>> {
    // A panic while holding it leaves nothing half-written: a flag is a flag.
    WAITING.lock().unwrap_or_else(|e| e.into_inner())
}

/// A login's hold on the slot. Dropping it (the login ended, however) frees
/// the slot, unless a newer login has taken it since.
pub struct Ticket(Arc<AtomicBool>);

impl Ticket {
    /// Whether the user, or a newer login, called this one off.
    pub fn cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        let mut slot = slot();
        if slot.as_ref().is_some_and(|f| Arc::ptr_eq(f, &self.0)) {
            *slot = None;
        }
    }
}

/// Start waiting on a login, cancelling any login still waiting.
pub fn begin() -> Ticket {
    let flag = Arc::new(AtomicBool::new(false));
    if let Some(old) = slot().replace(flag.clone()) {
        old.store(true, Ordering::SeqCst);
    }
    Ticket(flag)
}

/// Cancel the login that's waiting, if any. True when there was one.
pub fn cancel() -> bool {
    match slot().take() {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // One test, because the slot is process-wide and tests run in parallel.
    #[test]
    fn a_new_login_or_a_cancel_calls_the_waiting_one_off() {
        let first = begin();
        assert!(!first.cancelled());
        let second = begin();
        assert!(first.cancelled(), "superseded");
        assert!(!second.cancelled());
        drop(first); // the old one ending doesn't free the newer one's slot
        assert!(cancel());
        assert!(second.cancelled());
        assert!(!cancel(), "nothing left waiting");
        drop(second);
        let third = begin();
        drop(third);
        assert!(!cancel(), "an ended login frees the slot");
    }
}
