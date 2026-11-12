//! Server-sent events, as MCP's Streamable HTTP uses them: a POST may be
//! answered with `text/event-stream`, each event's `data:` lines holding one
//! JSON-RPC message. Fed in chunks as they arrive, so the answer can be taken
//! as soon as its event is complete, without waiting for the stream to close.

/// Accumulates a stream's bytes and hands back each finished event's data.
#[derive(Default)]
pub struct SseBuffer {
    /// Bytes of a line not yet ended.
    partial: Vec<u8>,
    /// The `data:` lines of the event in progress.
    data: Vec<String>,
}

impl SseBuffer {
    /// Take in a chunk; returns the data of every event it completed. A
    /// chunk may end mid-line, even mid-character: only whole lines are read
    /// (a newline is never inside a UTF-8 character).
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.partial.extend_from_slice(chunk);
        let mut done = Vec::new();
        while let Some(end) = self.partial.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.partial.drain(..=end).collect();
            let line = String::from_utf8_lossy(&line[..end]);
            self.line(line.strip_suffix('\r').unwrap_or(&line), &mut done);
        }
        done
    }

    /// The stream ended: whatever event was left unterminated.
    pub fn finish(&mut self) -> Vec<String> {
        let mut done = Vec::new();
        if !self.partial.is_empty() {
            let rest = std::mem::take(&mut self.partial);
            let line = String::from_utf8_lossy(&rest);
            self.line(line.strip_suffix('\r').unwrap_or(&line), &mut done);
        }
        self.dispatch(&mut done);
        done
    }

    fn line(&mut self, line: &str, done: &mut Vec<String>) {
        if line.is_empty() {
            self.dispatch(done);
        } else if let Some(value) = line.strip_prefix("data:") {
            self.data
                .push(value.strip_prefix(' ').unwrap_or(value).to_string());
        }
        // `event:`, `id:`, `retry:` and `:` comments carry nothing trace reads.
    }

    fn dispatch(&mut self, done: &mut Vec<String>) {
        if !self.data.is_empty() {
            done.push(std::mem::take(&mut self.data).join("\n"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_event_is_its_data_lines_up_to_a_blank_line() {
        let mut sse = SseBuffer::default();
        let got = sse.push(b"event: message\nid: 1\ndata: {\"a\":\ndata: 1}\n\n");
        assert_eq!(got, vec!["{\"a\":\n1}".to_string()]);
        assert!(sse.finish().is_empty());
    }

    #[test]
    fn chunks_split_anywhere_still_make_whole_events() {
        let stream =
            "data: {\"id\":1,\"text\":\"caf\u{e9}\"}\r\n\r\n: keep-alive\n\ndata:{\"id\":2}\n\n";
        let bytes = stream.as_bytes();
        for cut in 0..bytes.len() {
            let mut sse = SseBuffer::default();
            let mut got = sse.push(&bytes[..cut]);
            got.extend(sse.push(&bytes[cut..]));
            got.extend(sse.finish());
            assert_eq!(
                got,
                vec![
                    "{\"id\":1,\"text\":\"caf\u{e9}\"}".to_string(),
                    "{\"id\":2}".to_string()
                ],
                "cut at {cut}"
            );
        }
    }

    #[test]
    fn comments_and_empty_events_give_nothing() {
        let mut sse = SseBuffer::default();
        assert!(sse.push(b": ping\n\nevent: x\n\n").is_empty());
    }

    #[test]
    fn a_stream_that_ends_mid_event_still_gives_it() {
        let mut sse = SseBuffer::default();
        assert!(sse.push(b"data: {\"id\":3}").is_empty());
        assert_eq!(sse.finish(), vec!["{\"id\":3}".to_string()]);
    }
}
