//! A live check against Atlassian's MCP server, ignored by default:
//! `cargo test jira_mcp_live -- --ignored --nocapture`. It needs trace logged
//! in to Atlassian (Integrations → MCP servers, or Jira → Connect with your
//! Atlassian login); without that it says so and passes.

use super::{endpoint, open, Opened, SERVER_URL};
use crate::issues::mcp_link;
use crate::issues::{IssueProvider, ProviderKind};
use crate::mcp_client::http;

#[tokio::test]
#[ignore = "reaches mcp.atlassian.com with trace's login"]
async fn jira_mcp_live() {
    if !mcp_link::logged_in(SERVER_URL) {
        println!(
            "trace isn't logged in to {SERVER_URL}: nothing to check. Connect it in Integrations."
        );
        return;
    }
    let caller = http::for_url(&endpoint(SERVER_URL)).expect("a caller");
    let saved = mcp_link::load(ProviderKind::Jira).and_then(|l| l.cloud_id);
    let wanted = std::env::var("JIRA_MCP_CLOUD_ID").ok().or(saved);
    let conn = match open(caller, wanted.as_deref()).await.expect("connect") {
        Opened::Ready(conn) => conn,
        Opened::ChooseSite(sites) => {
            for s in &sites {
                println!("site {} ({}): {}", s.name, s.url, s.id);
            }
            println!("Several sites: set JIRA_MCP_CLOUD_ID to one of them.");
            return;
        }
    };
    let me = conn.current_user().await.expect("current user");
    println!("signed in as {} on {}", me.display_name, conn.site().url);
    let boards = conn.list_boards().await.expect("boards");
    println!("{} boards", boards.len());
    let Some(first) = boards.first() else {
        println!("no boards to load");
        return;
    };
    let board = conn.get_board(&first.id).await.expect("board");
    let columns: Vec<&str> = board.columns.iter().map(|c| c.name.as_str()).collect();
    println!(
        "{} ({}): columns {columns:?}, {} cards, sprint {:?}",
        board.board_name,
        first.board_type,
        board.issues.len(),
        board.sprint_name
    );
}
