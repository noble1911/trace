//! The real [`Connector`]: a plain WebSocket over the tailnet (Tailscale already
//! encrypts it) with blocking `tungstenite`, like every other pump here.

use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use tungstenite::protocol::WebSocketConfig;
use tungstenite::{Message, WebSocket};

use super::link::{Connector, Link, LinkError};
use crate::execution::peer::protocol::{Envelope, Event, Request};

/// How long to wait for a machine to answer at all.
const CONNECT_WITHIN: Duration = Duration::from_secs(4);

/// The largest frame either way, as on the server.
const MAX_FRAME: usize = 1024 * 1024;

pub struct WsConnector;

struct WsLink {
    ws: WebSocket<TcpStream>,
}

impl Connector for WsConnector {
    fn connect(&self, address: &str) -> Result<Box<dyn Link>, LinkError> {
        let unreachable = |why: String| LinkError::Unreachable(why);
        let addr = address
            .to_socket_addrs()
            .map_err(|e| unreachable(format!("Not an address: {e}")))?
            .next()
            .ok_or_else(|| unreachable("Not an address.".to_string()))?;
        let stream = TcpStream::connect_timeout(&addr, CONNECT_WITHIN)
            .map_err(|e| unreachable(format!("Nothing answered: {e}")))?;
        stream
            .set_write_timeout(Some(CONNECT_WITHIN))
            .map_err(|e| unreachable(e.to_string()))?;
        // The handshake gets the same budget as the connection.
        stream
            .set_read_timeout(Some(CONNECT_WITHIN))
            .map_err(|e| unreachable(e.to_string()))?;
        // The server's limit, so a hostile one can't make us buffer more.
        let config = WebSocketConfig {
            max_message_size: Some(MAX_FRAME),
            max_frame_size: Some(MAX_FRAME),
            ..WebSocketConfig::default()
        };
        let (ws, _) = tungstenite::client::client_with_config(
            format!("ws://{address}/"),
            stream,
            Some(config),
        )
        .map_err(|e| unreachable(format!("Not a trace server: {e}")))?;
        Ok(Box::new(WsLink { ws }))
    }
}

fn idle(e: &tungstenite::Error) -> bool {
    matches!(e, tungstenite::Error::Io(io)
        if matches!(io.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut))
}

impl Link for WsLink {
    fn send(&mut self, request: &Request, id: Option<u64>) -> Result<(), LinkError> {
        let env = Envelope {
            id,
            request: request.clone(),
        };
        let text = serde_json::to_string(&env).map_err(|e| LinkError::Lost(e.to_string()))?;
        self.ws
            .send(Message::text(text))
            .map_err(|e| LinkError::Lost(e.to_string()))
    }

    fn recv(&mut self, wait: Duration) -> Result<Option<Event>, LinkError> {
        self.ws
            .get_mut()
            .set_read_timeout(Some(wait.max(Duration::from_millis(1))))
            .map_err(|e| LinkError::Lost(e.to_string()))?;
        match self.ws.read() {
            Ok(Message::Text(t)) => Ok(serde_json::from_str(&t).ok()),
            Ok(Message::Close(_)) => Err(LinkError::Lost("The server hung up.".to_string())),
            Ok(_) => Ok(None),
            Err(e) if idle(&e) => Ok(None),
            Err(e) => Err(LinkError::Lost(e.to_string())),
        }
    }

    fn close(&mut self) {
        let _ = self.ws.close(None);
        let _ = self.ws.flush();
    }
}
