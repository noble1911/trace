//! Live smoke test for the Pylon provider against the real API. Not run in
//! normal `cargo test` — requires PYLON_API_KEY in the environment:
//!   PYLON_API_KEY=... cargo test --test pylon_live -- --nocapture

use trace_lib::issues::IssueProvider;
use trace_lib::pylon::{auth, PylonConnection};

fn conn_from_env() -> Option<PylonConnection> {
    let token = std::env::var("PYLON_API_KEY").ok()?;
    Some(PylonConnection::new(token))
}

#[tokio::test]
async fn validate_resolves_region_and_user() {
    let Some(conn) = conn_from_env() else {
        eprintln!("PYLON_API_KEY not set — skipping live test");
        return;
    };
    let (user, conn) = auth::validate(&conn).await.expect("validate failed");
    println!("region: {}", conn.base_url);
    println!("user: {} ({}) id={}", user.display_name, user.email.as_deref().unwrap_or("-"), user.account_id);
    assert!(!user.display_name.is_empty());
}

#[tokio::test]
async fn board_loads_columns_and_cards() {
    let Some(conn) = conn_from_env() else {
        eprintln!("PYLON_API_KEY not set — skipping live test");
        return;
    };
    let (_, conn) = auth::validate(&conn).await.expect("validate failed");

    let boards = conn.list_boards().await.expect("list_boards failed");
    assert_eq!(boards.len(), 1);
    let board = conn.get_board(&boards[0].id).await.expect("get_board failed");

    println!("board: {} ({} columns, {} cards)", board.board_name, board.columns.len(), board.issues.len());
    for col in &board.columns {
        let n = board
            .issues
            .iter()
            .filter(|i| col.statuses.iter().any(|s| s.id == i.status_id))
            .count();
        println!("  {:<20} {:<14} {} cards", col.name, col.statuses[0].id, n);
    }
    for issue in board.issues.iter().take(5) {
        println!(
            "  card {:<6} {:<16} {:<20} {}",
            issue.key,
            issue.status_id,
            issue.assignee.as_ref().map(|a| a.display_name.as_str()).unwrap_or("-"),
            issue.summary.chars().take(50).collect::<String>()
        );
    }
    assert!(!board.columns.is_empty());
    // Base states are always present, in order.
    assert_eq!(board.columns[0].statuses[0].id, "new");
    assert_eq!(board.columns.last().unwrap().statuses[0].id, "closed");
    // Every card lands in exactly one column.
    for issue in &board.issues {
        assert!(board.columns.iter().any(|c| c.statuses.iter().any(|s| s.id == issue.status_id)));
    }
}
