//! This trace as a client of another trace's peer server: connect and say hello
//! (`connect`), run one remote agent over the link (`session`, `live`), and
//! offer it as a host (`host`). The link is a trait (`link`), with a WebSocket
//! behind it (`ws`) and a scripted server for tests (`testing`), so the flow
//! tests without a listener.

pub mod connect;
pub mod host;
pub mod link;
pub mod live;
pub mod session;
#[cfg(test)]
pub(crate) mod testing;
pub mod ws;
