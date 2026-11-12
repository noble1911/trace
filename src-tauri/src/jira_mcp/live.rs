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
    // Every board (or just `JIRA_MCP_BOARD_ID`): counts only, no ticket or
    // person is named. A board that fails says why and the rest still load.
    let only = std::env::var("JIRA_MCP_BOARD_ID").ok();
    let mut failed = 0;
    for b in boards
        .iter()
        .filter(|b| only.as_ref().is_none_or(|o| *o == b.id))
    {
        match conn.get_board(&b.id).await {
            Ok(board) => {
                let per: Vec<String> = board
                    .columns
                    .iter()
                    .map(|c| {
                        let ids: Vec<&str> = c.statuses.iter().map(|s| s.id.as_str()).collect();
                        let n = board
                            .issues
                            .iter()
                            .filter(|i| ids.contains(&i.status_id.as_str()))
                            .count();
                        let cats: Vec<&str> =
                            c.statuses.iter().map(|s| s.category.as_str()).collect();
                        format!("{} {n} {cats:?}", c.name)
                    })
                    .collect();
                println!(
                    "board {} ({}): {} cards, sprint {}, columns: {}",
                    b.id,
                    b.board_type,
                    board.issues.len(),
                    board.sprint_name.is_some(),
                    per.join(" | ")
                );
            }
            Err(e) => {
                failed += 1;
                println!("board {} ({}): FAILED {e}", b.id, b.board_type);
            }
        }
    }
    assert_eq!(failed, 0, "{failed} boards didn't load");

    // The per-card reads, on the first card found: counts and categories
    // only. Reads only: the list of moves is read, never a move made.
    let mut card = None;
    for b in &boards {
        if let Ok(board) = conn.get_board(&b.id).await {
            if let Some(issue) = board.issues.into_iter().next() {
                card = Some(issue);
                break;
            }
        }
    }
    let Some(card) = card else {
        println!("no card to read");
        return;
    };
    let category = conn.status_category(&card.key).await.expect("category");
    println!(
        "a card: category {category} (the board said {})",
        card.status_category
    );
    let comments = conn.list_comments(&card.id).await.expect("comments");
    println!("its thread: {} comments", comments.len());
    let args = vec![
        conn.cloud(),
        crate::mcp_client::args::Arg::need("issueIdOrKey", serde_json::json!(card.key)),
    ];
    let moves = conn
        .call(&super::tools::TRANSITIONS, args)
        .await
        .expect("transitions");
    let parsed = super::parse::transitions(&moves);
    // Would a move to each column of the card's board find its transition?
    let mut reachable = 0;
    let mut columns = 0;
    for b in &boards {
        let Ok(board) = conn.get_board(&b.id).await else {
            continue;
        };
        if !board.issues.iter().any(|i| i.key == card.key) {
            continue;
        }
        for col in &board.columns {
            let ids: Vec<String> = col.statuses.iter().map(|s| s.id.clone()).collect();
            let names = super::statuses::names(&conn, &ids).await;
            columns += 1;
            if parsed.iter().any(|t| t.lands_on(&ids, &names)) {
                reachable += 1;
            }
        }
        break;
    }
    println!("its moves: {reachable} of its board's {columns} columns have a matching move");
    println!(
        "its moves: {} listed, {} read with a target status",
        super::live_probe::shape(&moves, 5),
        parsed.len()
    );
    let prs = conn.get_pull_requests(&card.id, false).await.expect("prs");
    println!("its linked PRs: {}", prs.len());
}
