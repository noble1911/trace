//! Fan-out of what happens to agents (output, run state, turns) to the peer
//! connections watching. The places that already tell the renderer publish here
//! too (`publish`); with nobody connected that costs one lock and no encoding.
//!
//! Every connection gets every event and keeps what it is attached to, so the hub
//! knows nothing about attaching. A connection that stops reading is dropped
//! rather than letting its queue grow: the hub never blocks an agent's pump.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::Arc;

use parking_lot::Mutex;

use super::protocol::Event;

/// Events a connection may have waiting. A TUI redraw is a few chunks, so this is
/// minutes of output for a reader that has merely stalled.
const QUEUE: usize = 4096;

#[derive(Default)]
pub struct Hub {
    subs: Mutex<Vec<(u64, SyncSender<Event>)>>,
    next: AtomicU64,
}

/// One connection's end of the hub. Dropping it unsubscribes.
pub struct Subscription {
    pub rx: Receiver<Event>,
    id: u64,
    hub: Arc<Hub>,
}

impl Hub {
    pub fn subscribe(self: &Arc<Self>) -> Subscription {
        let (tx, rx) = sync_channel(QUEUE);
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.subs.lock().push((id, tx));
        Subscription {
            rx,
            id,
            hub: self.clone(),
        }
    }

    /// Whether anyone is connected, so a publisher can skip building an event.
    pub fn is_idle(&self) -> bool {
        self.subs.lock().is_empty()
    }

    /// Send to everyone. One that is full is dropped: its receiver sees the
    /// channel close once it has read what was queued.
    pub fn publish(&self, event: &Event) {
        self.subs
            .lock()
            .retain(|(_, tx)| match tx.try_send(event.clone()) {
                Ok(()) => true,
                Err(TrySendError::Full(_)) => {
                    eprintln!("trace: peer server: a client fell behind and was dropped");
                    false
                }
                Err(TrySendError::Disconnected(_)) => false,
            });
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self.hub.subs.lock().retain(|(id, _)| *id != self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::TryRecvError;

    fn run_state() -> Event {
        Event::RunState {
            workspace_id: "w".into(),
            running: true,
            exited: false,
        }
    }

    #[test]
    fn every_subscriber_gets_every_event_and_leaving_unsubscribes() {
        let hub = Arc::new(Hub::default());
        assert!(hub.is_idle());
        let a = hub.subscribe();
        let b = hub.subscribe();
        hub.publish(&run_state());
        assert_eq!(a.rx.try_recv().ok(), Some(run_state()));
        assert_eq!(b.rx.try_recv().ok(), Some(run_state()));
        drop(a);
        drop(b);
        assert!(hub.is_idle());
    }

    #[test]
    fn a_client_that_stops_reading_is_dropped_not_waited_for() {
        let hub = Arc::new(Hub::default());
        let slow = hub.subscribe();
        for _ in 0..=QUEUE {
            hub.publish(&run_state());
        }
        assert!(hub.is_idle());
        // It still reads what was queued, then sees the channel closed.
        let mut n = 0;
        while slow.rx.try_recv().is_ok() {
            n += 1;
        }
        assert_eq!(n, QUEUE);
        assert!(matches!(
            slow.rx.try_recv(),
            Err(TryRecvError::Disconnected)
        ));
    }
}
