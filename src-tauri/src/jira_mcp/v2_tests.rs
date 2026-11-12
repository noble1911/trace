//! What Atlassian's real v2 server answers, as shapes seen live on
//! 2026-11-12 (the content here is made up): every answer under `data`, sites
//! with `products`, moves that name their target status without its id, a
//! failed Jira call reported inside a successful result, and the backlog.

use serde_json::json;

use super::site::sites;
use super::tests::{conn, every_tool};
use super::{open, Opened};
use crate::issues::IssueProvider;
use crate::mcp_client::fake::FakeCaller;

fn status(id: &str, name: &str, key: &str) -> serde_json::Value {
    json!({ "id": id, "name": name, "statusCategory": { "id": 2, "key": key, "name": name } })
}

fn issue(id: &str, key: &str, st: serde_json::Value) -> serde_json::Value {
    json!({ "id": id, "key": key, "fields": {
        "summary": "Tidy up", "status": st, "labels": [],
        "issuetype": { "id": "1", "name": "Task" }, "priority": { "id": "3", "name": "Medium" } } })
}

#[test]
fn a_v2_site_is_kept_by_its_jira_product_and_named_by_its_host() {
    let v = json!({ "resources": [
        { "cloudId": "c-1", "url": "https://acme.atlassian.net",
          "products": [{ "id": "jira", "access": "read-write" }, { "id": "loom", "access": "read-write" }] },
        { "cloudId": "c-2", "url": "https://wiki.atlassian.net",
          "products": [{ "id": "confluence", "access": "read-write" }, { "id": "jira-align", "access": "read-only" }] },
    ]});
    let found = sites(&v);
    assert_eq!(found.len(), 1, "jira-align isn't Jira");
    assert_eq!(
        (found[0].id.as_str(), found[0].name.as_str()),
        ("c-1", "acme.atlassian.net")
    );
}

#[tokio::test]
async fn connecting_reads_answers_from_under_data() {
    let fake = FakeCaller::new()
        .with(
            "getAccessibleAtlassianResources",
            json!({ "data": { "resources": [{ "cloudId": "c-1", "url": "https://acme.atlassian.net",
                "products": [{ "id": "jira", "access": "read-write" }] }] } }),
        )
        .with(
            "getJiraCurrentUser",
            json!({ "data": { "accountId": "u-1", "displayName": "Ada", "emailAddress": "ada@example.com" } }),
        )
        .listing(&every_tool());
    let Ok(Opened::Ready(c)) = open(fake, None).await else {
        panic!("one Jira site: connected");
    };
    assert_eq!(c.current_user().await.expect("user").account_id, "u-1");
}

#[tokio::test]
async fn a_failure_reported_in_a_result_is_an_error_with_jiras_words() {
    let fake = FakeCaller::new()
        .with(
            "listJiraBoards",
            json!({ "error": true, "statusCode": 403, "message": "You can't see boards here." }),
        )
        .listing(&every_tool());
    let err = conn(fake).list_boards().await.err().expect("refused");
    assert_eq!(
        err,
        "Jira refused listJiraBoards: You can't see boards here."
    );
}

#[tokio::test]
async fn a_move_is_matched_by_its_targets_name_when_no_id_is_given() {
    let fake = FakeCaller::new()
        .with(
            "listJiraIssueTransitions",
            json!({ "data": { "transitions": [
                { "id": "11", "name": "Start", "to": { "name": "In Progress", "statusCategory": { "key": "indeterminate" } } },
                { "id": "21", "name": "Finish", "to": { "name": "Done", "statusCategory": { "key": "done" } } },
            ] } }),
        )
        .with(
            "listJiraStatuses",
            json!({ "data": { "mode": "site", "statuses": [
                { "id": "10001", "name": "In Progress" }, { "id": "10002", "name": "Done" } ] } }),
        )
        .with("transitionJiraIssue", json!({ "data": { "ok": true } }))
        .listing(&every_tool());
    let c = conn(fake);
    c.transition_issue("PM-1", &["10002".to_string()])
        .await
        .expect("moved");
    let sent = &c.caller().calls_to("transitionJiraIssue")[0];
    assert!(sent.to_string().contains("21"), "the Done move: {sent}");
}

#[tokio::test]
async fn a_kanban_boards_backlog_column_is_left_off_like_jiras_own_board() {
    let fake = FakeCaller::new()
        .with(
            "getJiraBoardConfig",
            json!({ "data": { "id": 7, "name": "Delivery", "type": "kanban", "filter": { "id": "10201" },
                "columnConfig": { "columns": [
                    { "name": "Backlog", "statuses": [{ "id": "1" }] },
                    { "name": "Doing", "statuses": [{ "id": "2" }] } ] } } }),
        )
        .with(
            "listJiraBoards",
            json!({ "data": { "isLast": true, "values": [{ "id": 7, "name": "Delivery", "type": "kanban" }] } }),
        )
        .with(
            "getJiraBoardIssueData",
            json!({ "data": { "isLast": false, "issues": [issue("900", "PM-9", status("1", "Backlog", "new"))] } }),
        )
        .with(
            "searchJiraIssuesUsingJql",
            json!({ "data": { "isLast": true, "issues": [issue("901", "PM-2", status("2", "Doing", "indeterminate"))] } }),
        )
        .listing(&every_tool());
    let c = conn(fake);
    let board = c.get_board("7").await.expect("board");
    let names: Vec<&str> = board.columns.iter().map(|col| col.name.as_str()).collect();
    assert_eq!(names, ["Doing"]);
    let asked = c.caller().calls_to("getJiraBoardIssueData")[0].clone();
    assert_eq!(asked["dataset"], "backlog");
    let jql = c.caller().calls_to("searchJiraIssuesUsingJql")[0]["jql"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        jql.contains("status not in (\"1\")"),
        "backlog cards aren't fetched: {jql}"
    );
}
