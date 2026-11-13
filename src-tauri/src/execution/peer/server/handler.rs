//! What a paired connection's requests do. No sockets here: a request goes in and
//! the events to send come out, so it's tested against a fake `Backend`.

use std::collections::HashMap;
use std::sync::mpsc::Sender;
use std::sync::Arc;

use base64::Engine;

use crate::execution::peer::backend::{Backend, SpawnRequest};
use crate::execution::peer::protocol::{Envelope, Event, Request};

/// The most a `Spawn` prompt or `Input` may carry. Pasting a file is fine; a
/// megabyte of it is not a keystroke.
const MAX_TEXT: usize = 256 * 1024;

pub struct Handler {
    backend: Arc<dyn Backend>,
    /// Workspaces this client is attached to, with the last output seq it has
    /// been sent: a live chunk at or below it was already in the replay.
    attached: HashMap<String, u64>,
    /// Where a `Spawn`'s answer comes from, since it can take seconds
    /// (a worktree is made first) and output must keep flowing meanwhile.
    late: Sender<Event>,
}

fn error(id: Option<u64>, message: impl Into<String>) -> Event {
    Event::Error {
        id,
        message: message.into(),
    }
}

impl Handler {
    pub fn new(backend: Arc<dyn Backend>, late: Sender<Event>) -> Self {
        Handler {
            backend,
            attached: HashMap::new(),
            late,
        }
    }

    /// Serve one request after the connection is paired.
    pub fn handle(&mut self, env: Envelope) -> Vec<Event> {
        let id = env.id;
        match env.request {
            Request::Hello { .. } => vec![error(id, "Already connected.")],
            Request::List => vec![Event::Sessions {
                id,
                sessions: self.backend.sessions(),
            }],
            Request::Spawn {
                repo,
                cli,
                prompt,
                title,
                cols,
                rows,
            } => {
                if prompt.as_ref().is_some_and(|p| p.len() > MAX_TEXT) {
                    return vec![error(id, "That prompt is too long.")];
                }
                self.spawn(
                    id,
                    SpawnRequest {
                        repo,
                        cli,
                        prompt,
                        title,
                        cols,
                        rows,
                    },
                );
                Vec::new()
            }
            Request::Attach {
                workspace_id,
                from_seq,
            } => self.attach(id, workspace_id, from_seq),
            Request::Detach { workspace_id } => {
                self.attached.remove(&workspace_id);
                Vec::new()
            }
            Request::Input { workspace_id, data } => {
                let bytes = match base64::engine::general_purpose::STANDARD.decode(data) {
                    Ok(b) if b.len() <= MAX_TEXT => b,
                    Ok(_) => return vec![error(id, "That input is too long.")],
                    Err(_) => return vec![error(id, "Input must be base64.")],
                };
                self.done(id, self.backend.input(&workspace_id, &bytes))
            }
            Request::Resize {
                workspace_id,
                cols,
                rows,
            } => self.done(id, self.backend.resize(&workspace_id, cols, rows)),
            Request::Stop { workspace_id } => self.done(id, self.backend.stop(&workspace_id)),
        }
    }

    fn done(&self, id: Option<u64>, result: Result<(), String>) -> Vec<Event> {
        match result {
            Ok(()) => Vec::new(),
            Err(e) => vec![error(id, e)],
        }
    }

    fn spawn(&self, id: Option<u64>, request: SpawnRequest) {
        let backend = self.backend.clone();
        let late = self.late.clone();
        std::thread::spawn(move || {
            let reply = match backend.spawn(request) {
                Ok(workspace_id) => Event::Spawned { id, workspace_id },
                Err(e) => error(id, e),
            };
            let _ = late.send(reply);
        });
    }

    fn attach(&mut self, id: Option<u64>, workspace_id: String, from_seq: u64) -> Vec<Event> {
        let Some(replay) = self.backend.replay(&workspace_id, from_seq) else {
            return vec![error(id, "No such agent.")];
        };
        let mut out = vec![Event::Attached {
            id,
            workspace_id: workspace_id.clone(),
            reset: replay.reset,
            cols: replay.cols,
            rows: replay.rows,
        }];
        out.extend(replay.chunks.into_iter().map(|(seq, data)| Event::Output {
            workspace_id: workspace_id.clone(),
            seq,
            data,
        }));
        self.attached.insert(workspace_id, replay.last_seq);
        out
    }

    /// A live event from the hub: kept if this client is attached to its agent
    /// and hasn't already had it in a replay.
    pub fn live(&mut self, event: Event) -> Option<Event> {
        match &event {
            Event::Output {
                workspace_id, seq, ..
            } => {
                let last = self.attached.get_mut(workspace_id)?;
                if *seq <= *last {
                    return None;
                }
                *last = *seq;
                Some(event)
            }
            Event::RunState {
                workspace_id,
                running,
                ..
            } => {
                let last = self.attached.get_mut(workspace_id)?;
                if !*running {
                    // The next run counts its chunks from 1 again.
                    *last = 0;
                }
                Some(event)
            }
            Event::Turn { workspace_id, .. } => {
                self.attached.contains_key(workspace_id).then_some(event)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
#[path = "handler_tests.rs"]
mod tests;
