//! Never a silently wrong board, and never a silent no-op: what the adapter
//! refuses or works around, on a `FakeCaller`.

use serde_json::{json, Value};

use super::tests::{conn, fixture, tools_except};
use crate::issues::mcp_link::McpLink;
use crate::issues::IssueProvider;
use crate::mcp_client::fake::FakeCaller;
use crate::mcp_client::ToolInfo;

fn tool(name: &str, schema: Value) -> ToolInfo {
    ToolInfo {
        name: name.into(),
        description: String::new(),
        input_schema: schema,
    }
}

/// The fixtures' tools with `name`'s schema replaced.
fn with_schema(name: &str, schema: Value) -> Vec<ToolInfo> {
    let mut tools = tools_except(&[name]);
    tools.push(tool(name, schema));
    tools
}

#[tokio::test]
async fn a_filtered_search_that_finds_nothing_is_read_again_unfiltered() {
    let fake = FakeCaller::new()
        .with("search_issues", json!({ "data": [] }))
        .with("search_issues", fixture("search_p1"))
        .with("search_issues", fixture("search_p2"))
        .listing_tools(tools_except(&["get_issue_statuses", "search_users"]));
    let c = conn(fake);
    let board = c.get_board("open-issues").await.expect("board");
    assert_eq!(board.issues.len(), 3);
    let searches = c.caller().calls_to("search_issues");
    assert_eq!(searches.len(), 3, "filtered, then two unfiltered pages");
    assert!(searches[0].get("filter_json").is_some());
    assert_eq!(searches[1].get("filter_json"), None);
}

#[tokio::test]
async fn without_a_sort_argument_every_page_is_read_and_the_window_applied_here() {
    let old = json!({ "id": "x", "number": 9, "state": "new",
                      "created_at": (chrono::Utc::now() - chrono::Duration::days(40)).to_rfc3339() });
    let mut page1 = fixture("search_p1");
    page1["data"].as_array_mut().expect("list").push(old);
    let fake = FakeCaller::new()
        .with("search_issues", page1)
        .with("search_issues", fixture("search_p2"))
        .listing_tools(with_schema(
            "search_issues",
            json!({ "properties": { "cursor": {} } }),
        ));
    let c = conn(fake);
    let board = c.get_board("open-issues").await.expect("board");
    assert_eq!(
        c.caller().calls_to("search_issues").len(),
        2,
        "the order wasn't asked for, so an old issue on page 1 doesn't end the read"
    );
    let keys: Vec<&str> = board.issues.iter().map(|i| i.key.as_str()).collect();
    assert_eq!(keys, ["#101", "#102", "#103"], "#9 is outside the window");
}

#[tokio::test]
async fn issues_none_of_which_read_are_an_error_not_an_empty_board() {
    let fake = FakeCaller::new()
        .with(
            "search_issues",
            json!({ "data": [{ "title": "no id or number", "state": "new" }] }),
        )
        .listing_tools(tools_except(&["get_issue_statuses", "search_users"]));
    let err = conn(fake)
        .get_board("open-issues")
        .await
        .err()
        .expect("refused");
    assert_eq!(err, "Pylon's MCP server sent 1 issues trace couldn't read.");
}

#[tokio::test]
async fn text_in_place_of_a_search_result_is_an_error() {
    let fake = FakeCaller::new()
        .with("search_issues", json!("Something went wrong"))
        .listing_tools(tools_except(&[]));
    let err = conn(fake)
        .get_board("open-issues")
        .await
        .err()
        .expect("refused");
    assert!(
        err.ends_with("couldn't read: Something went wrong"),
        "{err}"
    );
}

#[tokio::test]
async fn a_move_the_server_ignored_is_an_error() {
    let fake = FakeCaller::new()
        .with("update_issue", json!({ "data": { "id": "iss-1" } }))
        .with(
            "get_issue",
            json!({ "data": { "id": "iss-1", "state": "new" } }),
        )
        .listing_tools(tools_except(&[]));
    let c = conn(fake);
    let err = c
        .transition_issue("#1", &["closed".into()])
        .await
        .expect_err("refused");
    assert_eq!(err, "Pylon accepted the move of #1, but it's still in new.");
}

#[tokio::test]
async fn a_card_number_goes_under_the_number_argument_when_both_are_listed() {
    let schema = json!({ "properties": { "issue_id": { "type": "string" },
                                         "issue_number": { "type": "integer" },
                                         "state": { "type": "string" } } });
    let fake = FakeCaller::new()
        .with("update_issue", json!({ "data": { "state": "closed" } }))
        .listing_tools(with_schema("update_issue", schema));
    let c = conn(fake);
    c.transition_issue("#7", &["closed".into()])
        .await
        .expect("moved");
    assert_eq!(
        c.caller().calls_to("update_issue"),
        [json!({ "issue_number": 7, "state": "closed" })]
    );
}

#[tokio::test]
async fn a_card_number_is_refused_where_only_a_uuid_goes() {
    let schema = json!({ "properties": { "issue_id": { "type": "string", "format": "uuid" } } });
    let c = conn(FakeCaller::new().listing_tools(with_schema("get_issue", schema)));
    let err = c.status_category("#7").await.expect_err("refused");
    assert_eq!(
        err,
        "Pylon's get_issue takes an issue's id, not its number, so trace can't act on #7."
    );
    assert!(c.caller().calls().is_empty());
}

#[test]
fn a_saved_record_naming_another_server_is_refused() {
    let link = McpLink {
        server_url: "https://evil.example.com".into(),
        cloud_id: None,
        site_url: None,
        site_name: None,
    };
    let err = super::from_link(&link).err().expect("refused");
    assert!(err.contains("not Pylon's MCP server"), "{err}");
}
