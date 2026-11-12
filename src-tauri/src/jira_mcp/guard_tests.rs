//! Never a silently wrong board: what the adapter refuses rather than show, on
//! a `FakeCaller`.

use serde_json::json;

use super::tests::{conn, every_tool, fixture};
use crate::issues::mcp_link::McpLink;
use crate::issues::IssueProvider;
use crate::mcp_client::fake::FakeCaller;

fn board_with(config: serde_json::Value) -> FakeCaller {
    FakeCaller::new()
        .with("getJiraBoardConfig", config)
        .with("listJiraBoards", fixture("boards_p2"))
        .with("searchJiraIssuesUsingJql", fixture("search_p2"))
        .listing(&every_tool())
}

#[tokio::test]
async fn a_config_without_a_filter_never_searches_the_whole_site() {
    let config = json!({ "columnConfig": { "columns": [
        { "name": "To Do", "statuses": [{ "id": "10248" }] } ] } });
    let c = conn(board_with(config));
    let err = c.get_board("12").await.err().expect("refused");
    assert_eq!(
        err,
        "Atlassian's MCP server returned a board configuration trace couldn't read (no filter)."
    );
    assert!(c.caller().calls_to("searchJiraIssuesUsingJql").is_empty());
}

#[tokio::test]
async fn a_config_whose_columns_dont_read_is_an_error_not_an_empty_board() {
    let config = json!({ "filter": { "id": 5 }, "columnConfig": { "lanes": [] } });
    let err = conn(board_with(config))
        .get_board("12")
        .await
        .err()
        .expect("refused");
    assert!(err.ends_with("(no columns)."), "{err}");
}

#[tokio::test]
async fn text_in_place_of_json_is_an_error_quoting_it() {
    let fake = FakeCaller::new()
        .with("listJiraBoards", json!("You don't have access to boards."))
        .listing(&every_tool());
    let err = conn(fake).list_boards().await.err().expect("refused");
    assert_eq!(
        err,
        "Atlassian's MCP server answered listJiraBoards with something trace couldn't read: \
         You don't have access to boards."
    );
}

#[tokio::test]
async fn a_page_of_issues_none_of_which_read_is_an_error() {
    let config = json!({ "filter": { "id": 5 }, "columns": [
        { "name": "To Do", "statuses": [{ "id": "1", "statusCategory": "new" }] } ] });
    let fake = FakeCaller::new()
        .with("getJiraBoardConfig", config)
        .with("listJiraBoards", fixture("boards_p2"))
        .with(
            "searchJiraIssuesUsingJql",
            json!({ "issues": [{ "summary": "no key" }, { "k": 1 }] }),
        )
        .listing(&every_tool());
    let err = conn(fake).get_board("12").await.err().expect("refused");
    assert_eq!(
        err,
        "Atlassian's MCP server sent 2 issues trace couldn't read."
    );
    let shapeless = FakeCaller::new()
        .with("searchJiraIssuesUsingJql", json!({ "data": {} }))
        .listing(&every_tool());
    let err = super::board::search(&conn(shapeless), "x")
        .await
        .err()
        .expect("refused");
    assert!(
        err.contains("issues in a shape trace couldn't read"),
        "{err}"
    );
}

#[tokio::test]
async fn a_repeated_page_token_ends_paging_and_no_card_shows_twice() {
    let page = fixture("search_p1"); // one issue, nextPageToken "page-2", forever
    let fake = FakeCaller::new()
        .with("searchJiraIssuesUsingJql", page)
        .listing(&every_tool());
    let c = conn(fake);
    let issues = super::board::search(&c, "x").await.expect("search");
    assert_eq!(issues.len(), 1);
    assert_eq!(
        c.caller().calls_to("searchJiraIssuesUsingJql").len(),
        2,
        "the second page repeats the token and adds nothing new"
    );
}

#[tokio::test]
async fn an_empty_column_is_placed_by_one_issue_on_the_site_in_its_status() {
    let config = json!({ "filter": { "id": 5 }, "columns": [
        { "name": "Up Next", "statuses": [{ "id": "10248" }] },
        { "name": "Done", "statuses": [{ "id": "10040" }] } ] });
    let done = json!({ "issues": [{ "id": "1", "key": "PM-1", "fields": {
        "summary": "old", "status": { "id": "10040", "name": "Shipped",
        "statusCategory": { "key": "done" } } } }] });
    let fake = FakeCaller::new()
        .with("getJiraBoardConfig", config)
        .with("listJiraBoards", fixture("boards_p2"))
        .with("searchJiraIssuesUsingJql", fixture("search_p2"))
        .with("searchJiraIssuesUsingJql", done)
        .listing(&every_tool());
    let c = conn(fake);
    let board = c.get_board("12").await.expect("board");
    let shipped = &board.columns[1].statuses[0];
    assert_eq!(
        (shipped.name.as_str(), shipped.category.as_str()),
        ("Shipped", "done")
    );
    let searches = c.caller().calls_to("searchJiraIssuesUsingJql");
    assert_eq!(searches[1]["jql"], "status = 10040");
    assert_eq!(searches[1]["maxResults"], 1);
}

#[tokio::test]
async fn a_column_nothing_can_place_fails_the_board() {
    let config = json!({ "filter": { "id": 5 }, "columns": [
        { "name": "Up Next", "statuses": [{ "id": "10248" }] },
        { "name": "QA", "statuses": [{ "id": "777" }] } ] });
    // The lookup finds only an issue in another status: 777 stays unknown.
    let err = conn(board_with(config))
        .get_board("12")
        .await
        .err()
        .expect("refused");
    assert!(err.contains("status 777 (QA)"), "{err}");
}

#[tokio::test]
async fn a_login_with_no_id_doesnt_validate() {
    let fake = FakeCaller::new()
        .with("getJiraCurrentUser", json!({ "name": "Someone" }))
        .listing(&every_tool());
    let err = conn(fake).current_user().await.err().expect("refused");
    assert_eq!(
        err,
        "Atlassian's MCP server didn't say who trace is signed in as."
    );
}

#[test]
fn the_tools_listed_flat_beside_the_execute_front_are_still_checked() {
    let names = [
        "getAccessibleAtlassianResources",
        "listJiraBoards",
        "executeRead",
    ];
    let tools = names
        .iter()
        .map(|n| crate::mcp_client::ToolInfo {
            name: n.to_string(),
            description: String::new(),
            input_schema: json!({}),
        })
        .collect();
    let err = super::tools::Toolset::from_list(tools)
        .err()
        .expect("missing");
    assert!(err.contains("getJiraBoardConfig"), "{err}");
}

#[test]
fn a_saved_record_naming_another_server_is_refused() {
    let link = McpLink {
        server_url: "https://evil.example.com/mcp".into(),
        cloud_id: Some("c".into()),
        site_url: None,
        site_name: None,
    };
    let err = super::from_link(&link).err().expect("refused");
    assert!(err.contains("not Atlassian's MCP server"), "{err}");
}
