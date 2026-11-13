//! Keeps the peer server matching the world: listening on this machine's
//! Tailscale IP while the setting is on and Tailscale is up, and not otherwise.
//!
//! A thread looks every [`POLL`] (and at once when the setting changes). If
//! Tailscale goes down or the IP changes, it stops the listener, hanging up its
//! clients, says so in the log, and binds again when an address returns. It asks
//! Tailscale nothing while the setting is off.

use std::net::SocketAddr;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::app_backend::AppBackend;
use super::server::{tailnet_ip, Listener, Shared};
use super::settings::{self, ServerSettings};
use super::tailscale::{self, TailnetState, TailscaleStatus};
use crate::state::AppState;

const POLL: Duration = Duration::from_secs(10);

/// What the server is doing, for Settings.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub enabled: bool,
    pub port: u16,
    /// `ip:port` while listening.
    pub listening: Option<String>,
    /// Why it isn't, when it's on but not listening.
    pub waiting_for: Option<String>,
    pub clients: usize,
}

/// What the world asks of the listener.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Want {
    Listen(SocketAddr),
    /// Not listening, and why.
    Not(String),
}

/// What to do about it.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    Keep,
    Start(SocketAddr),
    /// Stop what is up (its old address), then start `Option` if there is one.
    Stop(SocketAddr, Option<SocketAddr>),
    Idle,
}

/// Compare what is listening with what should be.
pub fn decide(current: Option<SocketAddr>, want: &Want) -> Step {
    match (current, want) {
        (Some(c), Want::Listen(w)) if c == *w => Step::Keep,
        (Some(c), Want::Listen(w)) => Step::Stop(c, Some(*w)),
        (None, Want::Listen(w)) => Step::Start(*w),
        (Some(c), Want::Not(_)) => Step::Stop(c, None),
        (None, Want::Not(_)) => Step::Idle,
    }
}

/// Where the server should be, from the setting and Tailscale's answer.
pub fn want(
    settings: &ServerSettings,
    tailscale: impl FnOnce() -> TailscaleStatus,
) -> (Want, String) {
    if !settings.enabled {
        return (Want::Not("switched off".into()), String::new());
    }
    let status = tailscale();
    let name = status
        .device
        .as_ref()
        .map(|d| d.name.clone())
        .unwrap_or_default();
    let want = match status.state {
        TailnetState::Running => match status.device.and_then(|d| d.ip) {
            Some(ip) => match tailnet_ip(&ip) {
                Ok(ip) => Want::Listen(SocketAddr::new(ip, settings.port)),
                Err(e) => Want::Not(e),
            },
            None => Want::Not("Tailscale has no address for this computer".into()),
        },
        TailnetState::NotInstalled => Want::Not("Tailscale isn't installed".into()),
        TailnetState::Stopped => Want::Not("Tailscale is off".into()),
        TailnetState::NeedsLogin => Want::Not("Tailscale needs you to log in".into()),
    };
    (want, name)
}

/// The supervisor, as Tauri state: the commands poke and read it.
pub struct PeerServer {
    wake: Sender<()>,
    status: Arc<Mutex<ServerStatus>>,
}

impl PeerServer {
    /// Look again now (the setting changed).
    pub fn wake(&self) {
        let _ = self.wake.send(());
    }

    pub fn status(&self) -> ServerStatus {
        self.status.lock().clone()
    }
}

/// Start the supervisor thread and register it as state.
pub fn start(app: AppHandle) {
    let (wake, woken) = channel::<()>();
    let status = Arc::new(Mutex::new(ServerStatus {
        enabled: false,
        port: settings::DEFAULT_PORT,
        listening: None,
        waiting_for: None,
        clients: 0,
    }));
    app.manage(PeerServer {
        wake,
        status: status.clone(),
    });
    let spawned = std::thread::Builder::new()
        .name("peer-supervisor".into())
        .spawn(move || watch(app, woken, status));
    if let Err(e) = spawned {
        eprintln!("trace: peer server: couldn't start its supervisor: {e}");
    }
}

fn watch(app: AppHandle, woken: std::sync::mpsc::Receiver<()>, status: Arc<Mutex<ServerStatus>>) {
    let mut listener: Option<Listener> = None;
    let mut last_said = String::new();
    loop {
        let settings = settings::load();
        let (wanted, name) = want(&settings, tailscale::status);
        let mut say = |line: String| {
            if line != last_said {
                eprintln!("trace: peer server: {line}");
                last_said = line;
            }
        };
        match decide(listener.as_ref().map(Listener::addr), &wanted) {
            Step::Keep | Step::Idle => {}
            Step::Start(addr) => listener = bind(&app, addr, &name, &mut say),
            Step::Stop(old, next) => {
                if let Some(l) = listener.take() {
                    l.stop();
                }
                say(match (&wanted, next) {
                    (Want::Not(why), _) => format!("stopped listening on {old}: {why}"),
                    (_, Some(new)) => format!("Tailscale address changed, {old} -> {new}"),
                    _ => format!("stopped listening on {old}"),
                });
                if let Some(addr) = next {
                    listener = bind(&app, addr, &name, &mut say);
                }
            }
        }
        if let (None, Want::Not(why)) = (&listener, &wanted) {
            if settings.enabled {
                say(format!("not listening: {why}; will try again"));
            }
        }
        *status.lock() = ServerStatus {
            enabled: settings.enabled,
            port: settings.port,
            listening: listener.as_ref().map(|l| l.addr().to_string()),
            waiting_for: match (&listener, &wanted) {
                (None, Want::Not(why)) if settings.enabled => Some(why.clone()),
                _ => None,
            },
            clients: listener.as_ref().map_or(0, Listener::clients),
        };
        match woken.recv_timeout(POLL) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn bind(
    app: &AppHandle,
    addr: SocketAddr,
    name: &str,
    say: &mut impl FnMut(String),
) -> Option<Listener> {
    let hub = app.state::<AppState>().peer_hub.clone();
    let shared = Shared {
        backend: Arc::new(AppBackend::new(app.clone(), name.to_string())),
        hub,
        stop: Arc::new(AtomicBool::new(false)),
    };
    match Listener::start(addr, shared) {
        Ok(l) => {
            say(format!("listening on {addr}"));
            Some(l)
        }
        Err(e) => {
            say(format!("couldn't listen on {addr}: {e}; will try again"));
            None
        }
    }
}

#[cfg(test)]
#[path = "supervisor_tests.rs"]
mod tests;
