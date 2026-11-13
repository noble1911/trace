//! The peer server: a WebSocket listener on one address, and a thread for each
//! client (`connection`). Starting and stopping it as Tailscale comes and goes is
//! the supervisor's job (`peer::supervisor`); this only listens where it is told.
//!
//! The address is always this machine's tailnet IP, never `0.0.0.0`: [`tailnet_ip`]
//! is the only way the supervisor gets one, and it refuses anything outside
//! Tailscale's range.

mod connection;
mod deadline;
mod handler;
mod slots;
#[cfg(test)]
pub(crate) mod testing;

use std::net::{IpAddr, SocketAddr, TcpListener};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

pub use connection::Shared;
use slots::Slots;

/// How often the accept loop looks at the stop flag.
const POLL: Duration = Duration::from_millis(50);

/// Parse an address Tailscale reported, accepting only one it could have
/// assigned: IPv4 in 100.64.0.0/10. Anything else (a parse that went wrong, a
/// LAN address) is refused rather than listened on.
pub fn tailnet_ip(ip: &str) -> Result<IpAddr, String> {
    let parsed: std::net::Ipv4Addr = ip
        .parse()
        .map_err(|_| "Tailscale gave an address trace can't read.".to_string())?;
    let [a, b, ..] = parsed.octets();
    if a == 100 && (64..=127).contains(&b) {
        Ok(IpAddr::V4(parsed))
    } else {
        Err("That isn't a Tailscale address, so trace won't listen on it.".to_string())
    }
}

/// A listener that is up. Dropping it does not stop it; call [`Listener::stop`].
pub struct Listener {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
    slots: Slots,
    thread: Option<JoinHandle<()>>,
}

impl Listener {
    /// Bind `addr` and start accepting. Connections get `shared.backend` and
    /// `shared.hub`; the stop flag is this listener's own.
    pub fn start(addr: SocketAddr, shared: Shared) -> std::io::Result<Listener> {
        let tcp = TcpListener::bind(addr)?;
        tcp.set_nonblocking(true)?;
        let addr = tcp.local_addr()?;
        let stop = shared.stop.clone();
        let slots = Slots::default();
        let held = slots.clone();
        let thread = std::thread::Builder::new()
            .name("peer-server".into())
            .spawn(move || accept_loop(tcp, shared, held))?;
        Ok(Listener {
            addr,
            stop,
            slots,
            thread: Some(thread),
        })
    }

    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// Paired clients connected now.
    pub fn clients(&self) -> usize {
        self.slots.paired()
    }

    /// Stop accepting and tell every client's thread to hang up. Returns once
    /// the port is free again.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn accept_loop(tcp: TcpListener, shared: Shared, slots: Slots) {
    while !shared.stop.load(Ordering::Relaxed) {
        match tcp.accept() {
            Ok((stream, from)) => {
                let Some(pending) = slots.admit(from.ip()) else {
                    eprintln!(
                        "trace: peer server: refused {}: too many unauthenticated connections",
                        from.ip()
                    );
                    continue;
                };
                let shared = shared.clone();
                let spawned = std::thread::Builder::new()
                    .name("peer-client".into())
                    .spawn(move || connection::serve(stream, shared, pending));
                if let Err(e) = spawned {
                    eprintln!("trace: peer server: couldn't start a connection thread: {e}");
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(POLL),
            Err(e) => {
                eprintln!("trace: peer server: accept failed: {e}");
                std::thread::sleep(POLL);
            }
        }
    }
}

#[cfg(test)]
mod tests;
