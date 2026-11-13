//! One client's connection: the WebSocket handshake, the pairing check, then the
//! loop that reads requests and writes what the hub streams.
//!
//! Nothing but `hello` is served until its token has matched
//! (`pairing::accepts`, constant time). A peer can start agents with any prompt
//! on this machine, so everything else is refused, loudly, in the log: the
//! address that asked and why, never the token it offered.

use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tungstenite::protocol::WebSocketConfig;
use tungstenite::{Message, WebSocket};

use super::handler::Handler;
use crate::execution::peer::backend::Backend;
use crate::execution::peer::hub::Hub;
use crate::execution::peer::pairing;
use crate::execution::peer::protocol::{parse_request, Envelope, Event, Request, PROTOCOL_VERSION};

/// How long a new connection has to say hello before it is dropped.
const HELLO_WITHIN: Duration = Duration::from_secs(5);
/// How often a connection checks that its token is still the server's, besides
/// before every request: rotating the token hangs up open connections.
const REVALIDATE: Duration = Duration::from_secs(1);
/// How often an idle connection looks for output to send. Reads wake it sooner.
const TICK: Duration = Duration::from_millis(25);
/// A client that won't take a frame for this long is gone.
const WRITE_WITHIN: Duration = Duration::from_secs(10);
/// A refused client waits before it learns so, which blunts guessing.
const REFUSAL_DELAY: Duration = Duration::from_millis(300);
/// The largest frame either way: a pasted file, not a download.
const MAX_FRAME: usize = 1024 * 1024;

type Socket = WebSocket<TcpStream>;

/// What every connection shares.
#[derive(Clone)]
pub struct Shared {
    pub backend: Arc<dyn Backend>,
    pub hub: Arc<Hub>,
    /// Set when the listener stops (Tailscale went, the setting was turned off).
    pub stop: Arc<AtomicBool>,
}

/// A name a client gave itself, fit for a log line.
fn tidy(name: &str) -> String {
    name.chars()
        .filter(|c| !c.is_control())
        .take(40)
        .collect::<String>()
}

fn send(ws: &mut Socket, event: &Event) -> Result<(), String> {
    // Our own events always serialize; the fallback only keeps this infallible.
    let text = serde_json::to_string(event).unwrap_or_else(|_| "{}".to_string());
    ws.send(Message::text(text)).map_err(|e| e.to_string())
}

fn is_idle(e: &tungstenite::Error) -> bool {
    matches!(e, tungstenite::Error::Io(io)
        if matches!(io.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut))
}

/// Serve one accepted connection until it ends. Blocking: runs on its own thread.
pub fn serve(stream: TcpStream, shared: Shared) {
    let who = stream
        .peer_addr()
        .map_or_else(|_| "unknown".to_string(), |a| a.ip().to_string());
    if stream.set_nonblocking(false).is_err()
        || stream.set_read_timeout(Some(HELLO_WITHIN)).is_err()
        || stream.set_write_timeout(Some(WRITE_WITHIN)).is_err()
    {
        eprintln!("trace: peer server: couldn't set up a connection from {who}");
        return;
    }
    let config = WebSocketConfig {
        max_message_size: Some(MAX_FRAME),
        max_frame_size: Some(MAX_FRAME),
        ..WebSocketConfig::default()
    };
    let mut ws = match tungstenite::accept_with_config(stream, Some(config)) {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("trace: peer server: handshake with {who} failed: {e}");
            return;
        }
    };
    let Some((name, token)) = greet(&mut ws, &shared, &who) else {
        return;
    };
    eprintln!("trace: peer server: {name} paired from {who}");
    let why = run(&mut ws, &shared, &token);
    let _ = ws.close(None);
    eprintln!("trace: peer server: {name} from {who} left: {why}");
}

/// Wait for `hello` and check it. The client's name when it is let in.
fn greet(ws: &mut Socket, shared: &Shared, who: &str) -> Option<(String, String)> {
    let deadline = Instant::now() + HELLO_WITHIN;
    let frame = loop {
        match ws.read() {
            Ok(Message::Text(t)) => break t,
            Ok(Message::Ping(_) | Message::Pong(_)) if Instant::now() < deadline => {}
            Ok(_) | Err(_) => {
                eprintln!("trace: peer server: refused {who}: no hello");
                return None;
            }
        }
    };
    let refuse = |ws: &mut Socket, log: &str, reason: &str| {
        eprintln!("trace: peer server: refused {who}: {log}");
        std::thread::sleep(REFUSAL_DELAY);
        let _ = send(
            ws,
            &Event::Refused {
                reason: reason.to_string(),
            },
        );
        let _ = ws.close(None);
        let _ = ws.flush();
    };
    let Ok(Envelope {
        request:
            Request::Hello {
                protocol,
                token,
                client_name,
            },
        ..
    }) = parse_request(&frame)
    else {
        refuse(ws, "first message wasn't hello", "Pair first: say hello.");
        return None;
    };
    let expected = match shared.backend.token() {
        Ok(t) => t,
        Err(e) => {
            refuse(ws, &format!("no pairing token ({e})"), "Not available.");
            return None;
        }
    };
    if !pairing::accepts(&expected, &token) {
        refuse(ws, "wrong pairing token", "Not paired with this trace.");
        return None;
    }
    if protocol != PROTOCOL_VERSION {
        refuse(
            ws,
            &format!("protocol {protocol}, this trace speaks {PROTOCOL_VERSION}"),
            &format!("This trace speaks protocol {PROTOCOL_VERSION}."),
        );
        return None;
    }
    let welcome = Event::Welcome {
        capabilities: shared.backend.capabilities(),
    };
    send(ws, &welcome).ok()?;
    Some((tidy(&client_name), token))
}

/// The paired loop. Returns why it ended, for the log.
fn run(ws: &mut Socket, shared: &Shared, token: &str) -> String {
    let sub = shared.hub.subscribe();
    let (late_tx, late_rx) = channel::<Event>();
    let mut handler = Handler::new(shared.backend.clone(), late_tx);
    if ws.get_mut().set_read_timeout(Some(TICK)).is_err() {
        return "couldn't set a read timeout".to_string();
    }
    let mut checked = Instant::now();
    loop {
        if shared.stop.load(Ordering::Relaxed) {
            return "the server stopped listening".to_string();
        }
        if checked.elapsed() >= REVALIDATE {
            checked = Instant::now();
            if let Some(why) = unpaired(ws, shared, token) {
                return why;
            }
        }
        match ws.read() {
            Ok(Message::Text(frame)) => {
                // The token is read afresh for every request.
                if let Some(why) = unpaired(ws, shared, token) {
                    return why;
                }
                let out = match parse_request(&frame) {
                    Ok(env) => handler.handle(env),
                    Err((id, message)) => vec![Event::Error { id, message }],
                };
                if let Err(e) = write_all(ws, out) {
                    return format!("write failed: {e}");
                }
            }
            Ok(Message::Close(_)) => return "closed by the client".to_string(),
            Ok(Message::Binary(_)) => {
                let e = Event::Error {
                    id: None,
                    message: "Frames are JSON text.".to_string(),
                };
                if write_all(ws, vec![e]).is_err() {
                    return "write failed".to_string();
                }
            }
            Ok(_) => {}
            Err(e) if is_idle(&e) => {}
            Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                return "closed".to_string();
            }
            Err(e) => return format!("read failed: {e}"),
        }
        // Spawn answers, then whatever the agents printed since the last tick.
        let mut out = drain(&late_rx);
        loop {
            match sub.rx.try_recv() {
                Ok(event) => out.extend(handler.live(event)),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return "fell behind, dropped".to_string(),
            }
        }
        if let Err(e) = write_all(ws, out) {
            return format!("write failed: {e}");
        }
        // Answers to pings the read queued.
        match ws.flush() {
            Err(e) if !is_idle(&e) => return format!("write failed: {e}"),
            _ => {}
        }
    }
}

/// Whether `token`, the one this client paired with, is still the server's. If
/// not (it was rotated, or can't be read) the client is told and the reason
/// returned, which ends the connection.
fn unpaired(ws: &mut Socket, shared: &Shared, token: &str) -> Option<String> {
    let still = shared
        .backend
        .token()
        .is_ok_and(|current| pairing::accepts(&current, token));
    if still {
        return None;
    }
    let _ = send(
        ws,
        &Event::Refused {
            reason: "Not paired with this trace any more.".to_string(),
        },
    );
    Some("the pairing token changed".to_string())
}

fn drain(rx: &Receiver<Event>) -> Vec<Event> {
    std::iter::from_fn(|| rx.try_recv().ok()).collect()
}

fn write_all(ws: &mut Socket, events: Vec<Event>) -> Result<(), String> {
    for event in &events {
        send(ws, event)?;
    }
    Ok(())
}
