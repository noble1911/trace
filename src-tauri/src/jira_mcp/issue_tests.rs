//! Moving an issue and its comments over MCP, on the real v1 schemas too.

use serde_json::json;

use super::tests::{conn, every_tool, fixture};
use crate::issues::IssueProvider;
use crate::mcp_client::fake::FakeCaller;
use crate::mcp_client::ToolInfo;

/// The real v1 schemas, plus bare entries for the board tools v1 lacks.
fn v1_listing() -> Vec<ToolInfo> {
    let mut tools: Vec<ToolInfo> = fixture("v1_schemas")["tools"]
        .as_array()
        .expect("tools")
        .iter()
        .map(|t| ToolInfo {
            name: t["name"].as_str().unwrap_or_default().to_string(),
            description: String::new(),
            input_schema: t["inputSchema"].clone(),
        })
        .collect();
    for name in ["listJiraBoards", "getJiraBoardConfig"] {
        tools.push(ToolInfo {
            name: name.into(),
            description: String::new(),
            input_schema: json!({ "type": "object" }),
        });
    }
    tools
}

#[tokio::test]
async fn arguments_follow_the_real_v1_schemas() {
    let fake = FakeCaller::new()
        .with("getTransitionsForJiraIssue", fixture("transitions"))
        .with("transitionJiraIssue", json!({}))
        .with("addCommentToJiraIssue", json!({ "id": "9" }))
        .with("searchJiraIssuesUsingJql", json!({ "issues": [] }))
        .listing_tools(v1_listing());
    let c = conn(fake);
    c.transition_issue("PM-1", &["3".into(), "10246".into()])
        .await
        .expect("moved");
    assert_eq!(
        c.caller().calls_to("transitionJiraIssue")[0],
        json!({ "cloudId": "c-acme", "issueIdOrKey": "PM-1", "transition": { "id": "21" } })
    );
    c.add_comment("PM-1", " Hi \n").await.expect("commented");
    assert_eq!(
        c.caller().calls_to("addCommentToJiraIssue")[0],
        json!({ "cloudId": "c-acme", "issueIdOrKey": "PM-1", "commentBody": "Hi",
                "contentFormat": "markdown" })
    );
    super::board::search(&c, "project = PM")
        .await
        .expect("search");
    let search = &c.caller().calls_to("searchJiraIssuesUsingJql")[0];
    assert!(search["fields"].is_array());
    assert_eq!(search["responseContentFormat"], "adf");
    assert_eq!(search.get("startAt"), None, "not in the schema");
}

#[tokio::test]
async fn a_move_the_workflow_forbids_says_where_it_can_go() {
    let fake = FakeCaller::new()
        .with("listJiraIssueTransitions", fixture("transitions"))
        .listing(&every_tool());
    let c = conn(fake);
    let err = c.transition_issue("PM-1", &["999".into()]).await.err();
    assert_eq!(
        err.as_deref(),
        Some("Jira's workflow won't move PM-1 there directly. Allowed from here: Up Next, In Progress, Done.")
    );
    assert!(c.caller().calls_to("transitionJiraIssue").is_empty());
}

#[tokio::test]
async fn comments_come_oldest_first_from_either_tool() {
    let listed = FakeCaller::new()
        .with("listJiraIssueComments", fixture("comments"))
        .listing(&every_tool());
    let bodies = |cs: Vec<crate::issues::models::IssueComment>| -> Vec<String> {
        cs.into_iter().map(|c| c.body).collect()
    };
    let got = conn(listed).list_comments("PM-1").await.expect("comments");
    assert_eq!(bodies(got), ["First, in Markdown", "Second"]);

    let names: Vec<&str> = every_tool()
        .into_iter()
        .filter(|n| *n != "listJiraIssueComments")
        .collect();
    let issue = json!({ "key": "PM-1", "fields": { "comment": fixture("comments") } });
    let fallback = FakeCaller::new()
        .with("getJiraIssue", issue)
        .listing(&names);
    let c = conn(fallback);
    let got = c.list_comments("PM-1").await.expect("comments");
    assert_eq!(bodies(got), ["First, in Markdown", "Second"]);
    assert_eq!(
        c.caller().calls_to("getJiraIssue")[0]["fields"],
        json!(["comment"])
    );
}
