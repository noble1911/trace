//! A socket whose reads share one deadline. A read timeout alone restarts with
//! every byte, so a client trickling the handshake could hold its slot for as
//! long as it liked; here the time left is recomputed before each read.

use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::time::Instant;

pub struct Deadline {
    pub tcp: TcpStream,
    /// While set, no read may wait past it. Cleared once the client is paired.
    pub until: Option<Instant>,
}

impl Read for Deadline {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if let Some(until) = self.until {
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(io::ErrorKind::TimedOut.into());
            }
            self.tcp.set_read_timeout(Some(left))?;
        }
        self.tcp.read(buf)
    }
}

impl Write for Deadline {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.tcp.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.tcp.flush()
    }
}
