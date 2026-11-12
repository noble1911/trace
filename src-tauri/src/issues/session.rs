//! Provider-session persistence. Each provider keeps its own credential file in
//! its auth module (`jira/auth.rs`, `pylon/auth.rs`), and all saved providers
//! are restored on launch — several can be connected at once. A tracker with
//! an MCP adapter is restored by `mcp_link`'s rule (API credentials win). Custom boards have
//! no login, so they're always there.

use crate::custom_boards::CustomBoards;
use crate::{jira, jira_mcp, pylon};

use super::mcp_link::{self, Pick};
use super::{Provider, ProviderKind};

/// Restore every saved provider connection on launch, plus custom boards.
pub fn restore_all() -> Vec<Provider> {
    let mut out = vec![Provider::Custom(CustomBoards::new())];
    // Saved API credentials win; else the MCP record, if trace is logged in.
    match mcp_link::restore(ProviderKind::Jira, jira::auth::load()) {
        Some(Pick::Api(conn)) => out.push(Provider::Jira(conn)),
        Some(Pick::Mcp(link)) => match jira_mcp::from_link(&link) {
            Ok(conn) => out.push(Provider::JiraMcp(conn)),
            Err(e) => eprintln!("trace: Jira over MCP not restored: {e}"),
        },
        None => {}
    }
    if let Some(conn) = pylon::auth::load() {
        out.push(Provider::Pylon(conn));
    }
    out
}
