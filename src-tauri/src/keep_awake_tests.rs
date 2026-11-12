use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use super::*;

#[test]
fn held_only_when_enabled_with_a_live_agent() {
    assert!(should_hold(true, 1));
    assert!(should_hold(true, 3));
    assert!(!should_hold(true, 0));
    assert!(!should_hold(false, 2));
    assert!(!should_hold(false, 0));
}

#[test]
fn terminal_shells_are_not_agents() {
    let ids = ["TRACE-1", "term:TRACE-1", "sched:7", "session-a"];
    assert_eq!(count_agents(ids.into_iter(), 0), 3);
    assert_eq!(count_agents(["term:x"].into_iter(), 2), 2);
    assert_eq!(count_agents(std::iter::empty(), 0), 0);
}

/// A fake port: counts how often it was held and released.
struct Fake {
    held: Arc<AtomicUsize>,
    released: Arc<AtomicUsize>,
}

impl Fake {
    fn new(available: bool) -> (Self, Holder) {
        let fake = Self {
            held: Arc::default(),
            released: Arc::default(),
        };
        let (held, released) = (fake.held.clone(), fake.released.clone());
        let holder = Holder::new(move || {
            held.fetch_add(1, Ordering::SeqCst);
            if !available {
                return None;
            }
            let released = released.clone();
            Some(SleepHold::new(move || {
                released.fetch_add(1, Ordering::SeqCst);
            }))
        });
        (fake, holder)
    }

    fn counts(&self) -> (usize, usize) {
        (
            self.held.load(Ordering::SeqCst),
            self.released.load(Ordering::SeqCst),
        )
    }
}

#[test]
fn each_transition_calls_the_port_once() {
    let (fake, mut holder) = Fake::new(true);
    holder.apply(false);
    assert_eq!(fake.counts(), (0, 0));
    holder.apply(true);
    holder.apply(true);
    holder.apply(true);
    assert_eq!(fake.counts(), (1, 0));
    holder.apply(false);
    holder.apply(false);
    assert_eq!(fake.counts(), (1, 1));
    holder.apply(true);
    assert_eq!(fake.counts(), (2, 1));
    drop(holder);
    assert_eq!(fake.counts(), (2, 2));
}

#[test]
fn a_machine_that_cannot_be_held_is_asked_once_per_wish() {
    let (fake, mut holder) = Fake::new(false);
    holder.apply(true);
    holder.apply(true);
    assert_eq!(fake.counts(), (1, 0));
    holder.apply(false);
    holder.apply(true);
    assert_eq!(fake.counts(), (2, 0));
}

/// The real macOS adapter: a `caffeinate` child exists while held and is gone after.
#[cfg(target_os = "macos")]
#[test]
fn macos_hold_runs_caffeinate_until_released() {
    fn caffeinate_children() -> String {
        let out = crate::platform::process::command("pgrep")
            .args(["-P", &std::process::id().to_string(), "-x", "caffeinate"])
            .output()
            .expect("pgrep runs");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }
    let hold = <Os as SleepInhibitor>::hold().expect("caffeinate starts");
    assert!(
        !caffeinate_children().is_empty(),
        "no caffeinate child while held"
    );
    drop(hold);
    assert!(
        caffeinate_children().is_empty(),
        "caffeinate outlived its hold"
    );
}
