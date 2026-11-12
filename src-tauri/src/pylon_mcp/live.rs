//! A live check against Pylon's MCP server, ignored by default:
//! `cargo test pylon_mcp_live -- --ignored --nocapture`. It needs trace
//! logged in to Pylon's US or EU server (Integrations → MCP servers, or
//! Pylon → Connect with your Pylon login); without that it says so and
//! passes. It prints column names and the card count only: no issue data.

use super::{open, region};
use crate::issues::{mcp_link, IssueProvider};
use crate::mcp_auth::catalog::Region;
use crate::mcp_client::http;

#[tokio::test]
#[ignore = "reaches Pylon's MCP server with trace's login"]
async fn pylon_mcp_live() {
    let logged_in: Vec<Region> = [Region::Us, Region::Eu]
        .into_iter()
        .filter(|r| mcp_link::logged_in(region::url(*r)))
        .collect();
    if logged_in.is_empty() {
        println!("trace isn't logged in to Pylon's MCP server: nothing to check. Connect it in Integrations.");
        return;
    }
    for r in logged_in {
        let url = region::url(r);
        let caller = http::for_url(url).expect("a caller");
        let conn = match open(caller, url).await {
            Ok(conn) => conn,
            Err(e) => {
                println!("{url}: {e}");
                continue;
            }
        };
        if let Err(e) = conn.current_user().await {
            println!("{url}: the login doesn't validate: {e}");
            continue;
        }
        let board = conn.get_board("open-issues").await.expect("board");
        let columns: Vec<&str> = board.columns.iter().map(|c| c.name.as_str()).collect();
        println!("{url}: columns {columns:?}, {} cards", board.issues.len());
    }
}
