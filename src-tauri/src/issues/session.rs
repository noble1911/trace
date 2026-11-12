//! Provider-session persistence. Each provider keeps its own credential file in
//! its auth module (`jira/auth.rs`, `pylon/auth.rs`), and all saved providers
//! are restored on launch — several can be connected at once. Custom boards have
//! no login, so they're always there.

use crate::custom_boards::CustomBoards;
use crate::{jira, pylon};

use super::Provider;

/// Restore every saved provider connection on launch, plus custom boards.
pub fn restore_all() -> Vec<Provider> {
    let mut out = vec![Provider::Custom(CustomBoards::new())];
    if let Some(conn) = jira::auth::load() {
        out.push(Provider::Jira(conn));
    }
    if let Some(conn) = pylon::auth::load() {
        out.push(Provider::Pylon(conn));
    }
    out
}
