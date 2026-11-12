//! The adapter on a `FakeCaller` with recorded payloads (`fixtures/`, trimmed
//! and anonymised; the v1 schemas and REST-shaped results are real, the board
//! payloads follow REST's Agile shapes).

use serde_json::{json, Value};

use super::site::Site;
use super::tools::ALL;
use super::{open, JiraMcp, Opened};
use crate::issues::{IssueProvider, Via};
use crate::mcp_client::fake::FakeCaller;

pub(super) fn fixture(name: &str) -> Value {
    let path = format!(
        "{}/src/jira_mcp/fixtures/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).expect("fixture");
    serde_json::from_str(&text).expect("fixture JSON")
}

/// Every tool the adapter knows, by its preferred name.
pub(super) fn every_tool() -> Vec<&'static str> {
    ALL.iter().map(|op| op.names[0]).collect()
}

fn acme() -> Site {
    Site {
        id: "c-acme".into(),
        name: "acme".into(),
        url: "https://acme.atlassian.net".into(),
    }
}

pub(super) fn conn(fake: FakeCaller) -> JiraMcp<FakeCaller> {
    JiraMcp::new(fake, acme())
}

#[tokio::test]
async fn boards_are_listed_across_pages() {
    let fake = FakeCaller::new()
        .with("listJiraBoards", fixture("boards_p1"))
        .with("listJiraBoards", fixture("boards_p2"))
        .listing(&every_tool());
    let c = conn(fake);
    let boards = c.list_boards().await.expect("boards");
    let ids: Vec<&str> = boards.iter().map(|b| b.id.as_str()).collect();
    assert_eq!(ids, ["7", "9", "12"]);
    assert_eq!(boards[2].board_type, "simple");
    let calls = c.caller().calls_to("listJiraBoards");
    assert_eq!(calls.len(), 2, "isLast ends it");
    assert_eq!(calls[0]["cloudId"], "c-acme");
    assert_eq!(calls[1]["startAt"], 2);
}

fn kanban_board() -> FakeCaller {
    FakeCaller::new()
        .with("getJiraBoardConfig", fixture("board_config"))
        .with("listJiraBoards", fixture("boards_p1"))
        .with("listJiraBoards", fixture("boards_p2"))
        .with("searchJiraIssuesUsingJql", fixture("search_p1"))
        .with("searchJiraIssuesUsingJql", fixture("search_p2"))
        .listing(&every_tool())
}

#[tokio::test]
async fn a_board_is_its_config_columns_and_what_it_shows() {
    let c = conn(kanban_board());
    let board = c.get_board("7").await.expect("board");
    assert_eq!(board.board_name, "PM Delivery");
    assert_eq!(board.sprint_name, None);
    let names: Vec<&str> = board.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(
        names,
        ["Up Next", "In Progress", "Done"],
        "backlog and empty dropped"
    );
    let progress = &board.columns[1].statuses;
    assert_eq!(
        (progress[0].name.as_str(), progress[0].category.as_str()),
        ("In Progress", "indeterminate")
    );
    assert_eq!(board.columns[2].statuses[0].category, "done");

    let searches = c.caller().calls_to("searchJiraIssuesUsingJql");
    assert_eq!(
        searches[0]["jql"],
        "(filter = 10100) AND (fixVersion in unreleasedVersions() OR fixVersion is EMPTY) \
         AND status not in (\"10039\") \
         AND (statusCategory != Done OR statusCategoryChangedDate >= -2w) ORDER BY Rank ASC"
    );
    assert_eq!(searches[0].get("nextPageToken"), None);
    assert_eq!(searches[1]["nextPageToken"], "page-2");
    assert_eq!(searches.len(), 2);
    assert!(
        c.caller().calls_to("listJiraBoardSprints").is_empty(),
        "kanban"
    );
    assert_eq!(board.issues.len(), 2);
}

#[tokio::test]
async fn cards_map_like_the_rest_adapters() {
    let board = conn(kanban_board()).get_board("7").await.expect("board");
    let a = &board.issues[0];
    assert_eq!((a.key.as_str(), a.id.as_str()), ("PM-4831", "24706"));
    assert_eq!(a.priority, "p1");
    assert_eq!(a.epic.as_deref(), Some("Housekeeping"));
    assert_eq!(a.epic_key.as_deref(), Some("PM-100"));
    assert_eq!(a.description.as_deref(), Some("Remove the getter."));
    assert_eq!(a.assignee.as_ref().map(|x| x.initial.as_str()), Some("A"));
    assert_eq!(a.labels, ["dead-code"]);
    let b = &board.issues[1];
    assert_eq!(b.priority, "p3");
    assert!(b.assignee.is_none());
    assert_eq!(
        b.description.as_deref(),
        Some("Already **Markdown**, as the `markdown` format sends it.")
    );
}

#[tokio::test]
async fn a_scrum_board_scopes_to_its_running_sprint() {
    let config = json!({ "filter": { "id": 55 }, "columnConfig": { "columns": [
        { "name": "To Do", "statuses": [{ "id": "1" }] } ] } });
    let sprints = json!({ "values": [{ "id": 4, "name": "Sprint 4", "state": "active" }] });
    let fake = FakeCaller::new()
        .with("getJiraBoardConfig", config)
        .with("listJiraBoards", fixture("boards_p1"))
        .with("listJiraBoards", fixture("boards_p2"))
        .with("listJiraBoardSprints", sprints)
        .with(
            "searchJiraIssuesUsingJql",
            json!({ "issues": [], "isLast": true }),
        )
        .listing(&every_tool());
    let c = conn(fake);
    let board = c.get_board("9").await.expect("board");
    assert_eq!(board.sprint_name.as_deref(), Some("Sprint 4"));
    assert_eq!(
        c.caller().calls_to("searchJiraIssuesUsingJql")[0]["jql"],
        "(filter = 55) AND sprint in openSprints() ORDER BY Rank ASC"
    );
}

#[tokio::test]
async fn connecting_names_the_missing_tools() {
    let fake = FakeCaller::new()
        .with("getAccessibleAtlassianResources", fixture("sites"))
        .listing(&[
            "getAccessibleAtlassianResources",
            "searchJiraIssuesUsingJql",
        ]);
    let err = open(fake, None).await.err().expect("refused");
    assert!(
        err.starts_with("Atlassian's MCP server doesn't offer getJiraCurrentUser, listJiraBoards")
    );
    assert!(err.ends_with("which trace's Jira board needs."));
}

#[tokio::test]
async fn several_sites_are_offered_and_a_saved_one_is_kept() {
    let fake = || {
        FakeCaller::new()
            .with("getAccessibleAtlassianResources", fixture("sites"))
            .listing(&every_tool())
    };
    let Ok(Opened::ChooseSite(sites)) = open(fake(), None).await else {
        panic!("a choice of sites");
    };
    let ids: Vec<&str> = sites.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ids,
        ["c-acme", "c-beta"],
        "merged by id; Confluence-only left out"
    );
    let Ok(Opened::Ready(c)) = open(fake(), Some("c-beta")).await else {
        panic!("the saved site");
    };
    assert_eq!(c.site().url, "https://beta.atlassian.net");
    assert!(c.caller().calls_to("getAccessibleAtlassianResources")[0]
        .as_object()
        .is_some_and(|a| a.is_empty()));
}

#[tokio::test]
async fn behind_the_execute_front_calls_are_routed() {
    let fake = FakeCaller::new()
        .with(
            "getAccessibleAtlassianResources",
            json!([fixture("sites")[1]]),
        )
        .with("executeRead", json!({ "result": fixture("boards_p2") }))
        .listing(&[
            "getAccessibleAtlassianResources",
            "discover",
            "executeRead",
            "executeWrite",
        ]);
    let Ok(Opened::Ready(c)) = open(fake, None).await else {
        panic!("the only site");
    };
    let boards = c.list_boards().await.expect("boards");
    assert_eq!(boards[0].name, "Team board");
    let call = &c.caller().calls_to("executeRead")[0];
    assert_eq!(call["toolName"], "listJiraBoards");
    assert_eq!(call["arguments"]["cloudId"], "c-acme");
}

#[tokio::test]
async fn the_session_says_mcp_and_the_user_reads_from_the_profile() {
    let fake = FakeCaller::new()
        .with("getJiraCurrentUser", fixture("user_info"))
        .listing(&every_tool());
    let c = conn(fake);
    let user = c.current_user().await.expect("user");
    assert_eq!(
        (user.display_name.as_str(), user.account_id.as_str()),
        ("Ada Lovelace", "712020:abc")
    );
    let session = c.session_info();
    assert_eq!(session.via, Via::Mcp);
    assert_eq!(session.site.as_deref(), Some("acme.atlassian.net"));
    assert!(c
        .get_pull_requests("24706", false)
        .await
        .expect("prs")
        .is_empty());
}
