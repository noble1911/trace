//! One agent on a peer, from this trace's side: connect, spawn it or find the
//! one a record names, attach, then carry keystrokes up and the screen down
//! until the agent ends, the session is stopped, or the line drops.
//!
//! The thread owns the link, as the sandbox session does. No Tauri here: it
//! reports through a [`Sink`], so the whole flow runs against a scripted server.
//! Prompts and screen bytes pass through; nothing of them is logged.

use std::sync::mpsc::{Receiver, TryRecvError};
use std::time::{Duration, Instant};

use base64::Engine;

use super::connect::{check, open, Peer};
use super::link::{Connector, Link, LinkError};
use crate::execution::peer::protocol::{Event, Request};

/// How often the pump looks for keystrokes between reads.
const TICK: Duration = Duration::from_millis(25);
/// A spawn makes a worktree first, which can take a while.
const SPAWN_WITHIN: Duration = Duration::from_secs(120);

/// What the session needs from its surroundings.
pub trait Sink: Send {
    /// A fresh screen at this size: the replay is about to fill it.
    fn begin(&self, cols: u16, rows: u16);
    /// Screen bytes. False once nobody wants them (the session was deleted).
    fn output(&self, bytes: &[u8]) -> bool;
    fn say(&self, line: &str);
    fn fail(&self, line: &str);
    /// A turn ended or needs a person on the peer.
    fn turn(&self, turn: &Event);
    /// The peer made the session: remember its id, which Start rejoins.
    fn spawned(&self, remote_id: &str);
    /// The peer no longer has it: forget the id so Start makes a new one.
    fn forget(&self);
}

pub enum Cmd {
    Input(Vec<u8>),
    Resize(u16, u16),
    Stop,
}

/// What to run, and where.
pub struct Plan {
    pub peer: Peer,
    /// The peer's repo name (`capabilities.repos[].name`).
    pub repo: String,
    /// The peer's id for the session, once it has one.
    pub remote_id: Option<String>,
    pub cli: String,
    pub prompt: Option<String>,
    pub title: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// How a run ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ended {
    /// Stop: the agent was ended on the peer.
    Stopped,
    /// Dropped: this trace let go and the agent works on.
    Detached,
    /// The agent ended on its own.
    Exited,
    /// Never got going, or the peer no longer has it.
    Failed,
    /// The line dropped while attached.
    Lost,
}

/// Run until it ends. Blocking: call it on the session's own thread.
pub fn run(connector: &dyn Connector, plan: &Plan, sink: &dyn Sink, rx: &Receiver<Cmd>) -> Ended {
    sink.begin(plan.cols, plan.rows);
    let name = plan.peer.name.as_str();
    sink.say(&format!("Connecting to {name}…"));
    let (mut link, caps) = match open(connector, &plan.peer) {
        Ok(opened) => opened,
        Err(why) => {
            sink.fail(&why);
            return Ended::Failed;
        }
    };
    let remote = match &plan.remote_id {
        Some(id) => match rejoin(&mut *link, plan, id) {
            Ok(true) => id.clone(),
            Ok(false) => {
                sink.forget();
                sink.say(&format!(
                    "That session isn't running on {name} any more. Start makes a new one."
                ));
                link.close();
                return Ended::Failed;
            }
            Err(why) => return lost(&mut *link, sink, name, &why),
        },
        None => {
            if let Err(why) = check(&caps, name, &plan.cli, &plan.repo) {
                sink.fail(&why);
                link.close();
                return Ended::Failed;
            }
            sink.say(&format!("Starting {} on {name}…", plan.cli));
            match spawn(&mut *link, plan) {
                Ok(id) => {
                    sink.spawned(&id);
                    id
                }
                Err(why) => {
                    sink.fail(&why);
                    link.close();
                    return Ended::Failed;
                }
            }
        }
    };
    let attach = Request::Attach {
        workspace_id: remote.clone(),
        from_seq: 0,
    };
    // Our size wins from here: the last resize sets the shared PTY's.
    let resize = Request::Resize {
        workspace_id: remote.clone(),
        cols: plan.cols,
        rows: plan.rows,
    };
    if let Err(e) = link
        .send(&attach, Some(3))
        .and_then(|()| link.send(&resize, None))
    {
        return lost(&mut *link, sink, name, &e.to_string());
    }
    // A prompt for a session that is already running is typed into it: a spawn
    // takes its prompt itself.
    if let (Some(_), Some(text)) = (
        &plan.remote_id,
        plan.prompt.as_deref().filter(|p| !p.trim().is_empty()),
    ) {
        let typed = Request::Input {
            workspace_id: remote.clone(),
            data: base64::engine::general_purpose::STANDARD.encode(format!("{text}\r")),
        };
        if let Err(e) = link.send(&typed, None) {
            return lost(&mut *link, sink, name, &e.to_string());
        }
    }
    let ended = pump(&mut *link, &remote, name, sink, rx);
    link.close();
    ended
}

fn lost(link: &mut dyn Link, sink: &dyn Sink, name: &str, why: &str) -> Ended {
    sink.fail(&format!(
        "Lost the connection to {name}: {why}. The agent keeps running there; Start rejoins it."
    ));
    link.close();
    Ended::Lost
}

/// Whether the peer still runs `id`.
fn rejoin(link: &mut dyn Link, plan: &Plan, id: &str) -> Result<bool, String> {
    link.send(&Request::List, Some(2))
        .map_err(|e| e.to_string())?;
    let until = Instant::now() + Duration::from_secs(6);
    while Instant::now() < until {
        match link
            .recv(Duration::from_millis(200))
            .map_err(|e| e.to_string())?
        {
            Some(Event::Sessions { sessions, .. }) => {
                return Ok(sessions.iter().any(|s| s.workspace_id == id));
            }
            Some(Event::Error { message, .. }) => return Err(message),
            _ => {}
        }
    }
    Err(format!("{} didn't list its sessions.", plan.peer.name))
}

/// Ask the peer to start the agent. Returns its id for it.
fn spawn(link: &mut dyn Link, plan: &Plan) -> Result<String, String> {
    let request = Request::Spawn {
        repo: plan.repo.clone(),
        cli: plan.cli.clone(),
        prompt: plan.prompt.clone(),
        title: plan.title.clone(),
        cols: plan.cols,
        rows: plan.rows,
    };
    link.send(&request, Some(2)).map_err(|e| e.to_string())?;
    let until = Instant::now() + SPAWN_WITHIN;
    while Instant::now() < until {
        match link
            .recv(Duration::from_millis(200))
            .map_err(|e| e.to_string())?
        {
            Some(Event::Spawned { workspace_id, .. }) => return Ok(workspace_id),
            Some(Event::Error { message, .. }) => {
                return Err(format!("{}: {message}", plan.peer.name))
            }
            _ => {}
        }
    }
    Err(format!(
        "{} took too long to start the agent.",
        plan.peer.name
    ))
}

fn pump(
    link: &mut dyn Link,
    remote: &str,
    name: &str,
    sink: &dyn Sink,
    rx: &Receiver<Cmd>,
) -> Ended {
    let b64 = base64::engine::general_purpose::STANDARD;
    loop {
        loop {
            let sent = match rx.try_recv() {
                Ok(Cmd::Input(bytes)) => link.send(
                    &Request::Input {
                        workspace_id: remote.to_string(),
                        data: b64.encode(bytes),
                    },
                    None,
                ),
                Ok(Cmd::Resize(cols, rows)) => link.send(
                    &Request::Resize {
                        workspace_id: remote.to_string(),
                        cols,
                        rows,
                    },
                    None,
                ),
                Ok(Cmd::Stop) => {
                    let _ = link.send(
                        &Request::Stop {
                            workspace_id: remote.to_string(),
                        },
                        None,
                    );
                    sink.say(&format!("Stopped on {name}."));
                    return Ended::Stopped;
                }
                Err(TryRecvError::Empty) => break,
                // Dropped: let go, and leave the agent running there.
                Err(TryRecvError::Disconnected) => return Ended::Detached,
            };
            if let Err(e) = sent {
                return lost(link, sink, name, &e.to_string());
            }
        }
        match link.recv(TICK) {
            Ok(Some(Event::Output {
                workspace_id, data, ..
            })) if workspace_id == remote => {
                if let Ok(bytes) = b64.decode(data) {
                    if !sink.output(&bytes) {
                        return Ended::Detached;
                    }
                }
            }
            Ok(Some(Event::Attached { cols, rows, .. })) => sink.begin(cols, rows),
            Ok(Some(event @ Event::Turn { .. })) => sink.turn(&event),
            Ok(Some(Event::RunState {
                running: false,
                workspace_id,
                ..
            })) if workspace_id == remote => {
                sink.say(&format!("The agent on {name} ended."));
                return Ended::Exited;
            }
            Ok(Some(Event::Error { message, .. })) => sink.fail(&format!("{name}: {message}")),
            Ok(Some(Event::Refused { reason })) => {
                sink.fail(&format!("{name} hung up: {reason}"));
                return Ended::Failed;
            }
            Ok(_) => {}
            Err(LinkError::Unreachable(e) | LinkError::Lost(e)) => {
                return lost(link, sink, name, &e)
            }
        }
    }
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
