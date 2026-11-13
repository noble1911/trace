//! Who may hold a connection. Paired clients are capped together; sockets that
//! haven't said hello yet are capped per source address, and don't count against
//! the paired cap, so a flood of silent sockets can't keep a paired client out.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;

use parking_lot::Mutex;

/// Paired clients at once. A few phones and laptops, not a crowd.
pub const MAX_PAIRED: usize = 16;
/// Unauthenticated sockets from one address at once. A real client holds one
/// while it says hello; a few more cover a retry before the first times out.
pub const MAX_PENDING_PER_IP: usize = 4;

#[derive(Default)]
struct Counts {
    paired: usize,
    pending: HashMap<IpAddr, usize>,
}

/// The counts, shared by the accept loop and every connection.
#[derive(Clone, Default)]
pub struct Slots(Arc<Mutex<Counts>>);

/// An unauthenticated socket's place. Dropping it gives the place back.
pub struct Pending {
    slots: Slots,
    ip: IpAddr,
}

/// A paired client's place. Dropping it gives the place back.
pub struct Paired(Slots);

impl Slots {
    /// A place for a new socket from `ip`, or `None` when it has too many.
    pub fn admit(&self, ip: IpAddr) -> Option<Pending> {
        let mut c = self.0.lock();
        let n = c.pending.entry(ip).or_insert(0);
        if *n >= MAX_PENDING_PER_IP {
            return None;
        }
        *n += 1;
        Some(Pending {
            slots: self.clone(),
            ip,
        })
    }

    /// Paired clients now.
    pub fn paired(&self) -> usize {
        self.0.lock().paired
    }
}

impl Pending {
    /// The socket said hello with the right token: trade its place for a paired
    /// one. `None` when the paired places are all taken.
    pub fn promote(self) -> Option<Paired> {
        let mut c = self.slots.0.lock();
        if c.paired >= MAX_PAIRED {
            return None;
        }
        c.paired += 1;
        Some(Paired(self.slots.clone()))
        // `self` drops after this, releasing the pending place.
    }
}

impl Drop for Pending {
    fn drop(&mut self) {
        let mut c = self.slots.0.lock();
        if let Some(n) = c.pending.get_mut(&self.ip) {
            *n -= 1;
            if *n == 0 {
                c.pending.remove(&self.ip);
            }
        }
    }
}

impl Drop for Paired {
    fn drop(&mut self) {
        self.0 .0.lock().paired -= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(n: u8) -> IpAddr {
        IpAddr::from([100, 64, 0, n])
    }

    #[test]
    fn one_address_is_capped_and_gets_its_places_back() {
        let slots = Slots::default();
        let held: Vec<_> = (0..MAX_PENDING_PER_IP)
            .map(|_| slots.admit(ip(1)).expect("room"))
            .collect();
        assert!(slots.admit(ip(1)).is_none());
        assert!(
            slots.admit(ip(2)).is_some(),
            "another address is unaffected"
        );
        drop(held);
        assert!(slots.admit(ip(1)).is_some());
    }

    #[test]
    fn pending_sockets_never_use_paired_places() {
        let slots = Slots::default();
        let _idle: Vec<_> = (0..64).filter_map(|n| slots.admit(ip(n))).collect();
        assert_eq!(slots.paired(), 0);
        let mut paired = Vec::new();
        for n in 0..MAX_PAIRED {
            paired.push(
                slots
                    .admit(ip(200))
                    .and_then(Pending::promote)
                    .expect("room"),
            );
            assert_eq!(slots.paired(), n + 1);
        }
        assert!(slots.admit(ip(201)).and_then(Pending::promote).is_none());
        paired.pop();
        assert!(slots.admit(ip(201)).and_then(Pending::promote).is_some());
    }
}
