//! One issue on a `FakeCaller`: moves, notes (never replies), the thread,
//! the status category.

use serde_json::json;

use super::tests::{conn, fixture, tools_except};
use super::tools::CUSTOMER_REPLY;
use crate::issues::IssueProvider;
use crate::mcp_client::fake::FakeCaller;

fn fake() -> FakeCaller {
    FakeCaller::new()
        .with(
            "update_issue",
            json!({ "data": { "id": "iss-123", "state": "on_hold" } }),
        )
        .with("send_issue_note", json!({ "data": { "id": "m-9" } }))
        .with(CUSTOMER_REPLY, json!({ "data": { "id": "m-10" } }))
        .with("get_issue_messages", fixture("messages"))
        .with("get_issue_messages", fixture("messages_p2"))
        .with(
            "get_issue",
            json!({ "data": { "id": "iss-123", "number": 123, "state": "closed" } }),
        )
        .listing_tools(tools_except(&[]))
}

#[tokio::test]
async fn a_move_sets_the_state_by_slug_on_the_issue_number() {
    let c = conn(fake());
    let targets = vec!["on_hold".to_string(), "closed".to_string()];
    c.transition_issue("#123", &targets).await.expect("moved");
    let calls = c.caller().calls_to("update_issue");
    assert_eq!(calls, [json!({ "issue_id": "123", "state": "on_hold" })]);
    assert!(c.transition_issue("#123", &[]).await.is_err());
}

#[tokio::test]
async fn a_comment_is_an_internal_note_and_never_a_reply() {
    let c = conn(fake());
    c.add_comment("#123", "Fixed in <main>\nShips Friday")
        .await
        .expect("noted");
    let notes = c.caller().calls_to("send_issue_note");
    assert_eq!(
        notes,
        [json!({ "issue_id": "123",
                 "body_html": "<p>Fixed in &lt;main&gt;</p><p>Ships Friday</p>" })]
    );
    assert!(c.add_comment("#123", "  ").await.is_err(), "empty");
    // Everything else the adapter does, too: none of it reaches the customer.
    c.transition_issue("#123", &["closed".into()])
        .await
        .expect("moved");
    c.list_comments("iss-123").await.expect("thread");
    c.status_category("#123").await.expect("category");
    assert!(
        c.caller().calls_to(CUSTOMER_REPLY).is_empty(),
        "send_issue_reply writes to the customer"
    );
}

#[test]
fn the_customer_reply_tool_is_not_among_the_adapters_tools() {
    assert!(super::tools::ALL.iter().all(|op| op.name != CUSTOMER_REPLY));
}

#[tokio::test]
async fn the_thread_is_oldest_first_with_internal_notes_flagged() {
    let c = conn(fake());
    let thread = c.list_comments("iss-123").await.expect("thread");
    let bodies: Vec<&str> = thread.iter().map(|m| m.body.as_str()).collect();
    assert_eq!(
        bodies,
        [
            "It broke after the update.",
            "Looking into it.",
            "Fixed now, thanks!"
        ],
        "sorted by time; the empty one dropped, as on REST"
    );
    assert!(!thread[0].is_internal && thread[1].is_internal && !thread[2].is_internal);
    assert_eq!(thread[0].author, "A Customer");
    assert_eq!(thread[2].author, "jo@example.com");
    assert_eq!(thread[1].created.as_deref(), Some("2026-11-02T10:00:00Z"));
    let calls = c.caller().calls_to("get_issue_messages");
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0], json!({ "issue_id": "iss-123", "limit": 100 }));
    assert_eq!(calls[1]["cursor"], "m-page-2");
}

#[tokio::test]
async fn a_status_category_comes_from_the_issues_state() {
    let c = conn(fake());
    assert_eq!(c.status_category("#123").await.expect("category"), "done");
    assert_eq!(
        c.caller().calls_to("get_issue"),
        [json!({ "issue_id": "123" })]
    );
}

#[tokio::test]
async fn an_integer_issue_argument_gets_the_number() {
    let mut tools = tools_except(&["get_issue"]);
    tools.push(crate::mcp_client::ToolInfo {
        name: "get_issue".into(),
        description: String::new(),
        input_schema: json!({ "properties": { "number": { "type": "integer" } } }),
    });
    let fake = FakeCaller::new()
        .with(
            "get_issue",
            json!({ "issue": { "number": 7, "state": { "slug": "escalated" } } }),
        )
        .listing_tools(tools);
    let c = conn(fake);
    assert_eq!(
        c.status_category("#7").await.expect("category"),
        "indeterminate"
    );
    assert_eq!(c.caller().calls_to("get_issue"), [json!({ "number": 7 })]);
}
