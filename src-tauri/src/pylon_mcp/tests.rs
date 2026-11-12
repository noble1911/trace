//! The board on a `FakeCaller`. Pylon doesn't publish its MCP tools' schemas
//! or results, so the fixtures (`fixtures/`, anonymised) are modelled on its
//! REST API's shapes, with the variations the parsers tolerate mixed in.
//! Dates are written `@days_ago:<n>` and filled in relative to now.

use serde_json::{json, Value};

use super::tools::{ALL, CUSTOMER_REPLY};
use super::PylonMcp;
use crate::issues::mcp_link::{pick, McpLink, Pick};
use crate::issues::IssueProvider;
use crate::mcp_client::fake::FakeCaller;
use crate::mcp_client::ToolInfo;

const URL: &str = "https://mcp.eu.usepylon.com";

/// Replace each `@days_ago:<n>` with the time `n` days ago.
fn dated(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find("@days_ago:") {
        out.push_str(&rest[..at]);
        let tail = &rest[at + "@days_ago:".len()..];
        let digits: String = tail.chars().take_while(char::is_ascii_digit).collect();
        let days: i64 = digits.parse().unwrap_or(0);
        out.push_str(&(chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339());
        rest = &tail[digits.len()..];
    }
    out.push_str(rest);
    out
}

pub(super) fn fixture(name: &str) -> Value {
    let path = format!(
        "{}/src/pylon_mcp/fixtures/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).expect("fixture");
    serde_json::from_str(&dated(&text)).expect("fixture JSON")
}

/// The tools as the fixtures' guessed schemas describe them, minus `except`.
pub(super) fn tools_except(except: &[&str]) -> Vec<ToolInfo> {
    let schemas = fixture("schemas");
    let mut names: Vec<&str> = ALL.iter().map(|op| op.name).collect();
    names.push(CUSTOMER_REPLY);
    names
        .into_iter()
        .filter(|n| !except.contains(n))
        .map(|n| ToolInfo {
            name: n.to_string(),
            description: String::new(),
            input_schema: schemas[n].clone(),
        })
        .collect()
}

pub(super) fn conn(fake: FakeCaller) -> PylonMcp<FakeCaller> {
    PylonMcp::new(fake, URL)
}

fn board_fake() -> FakeCaller {
    FakeCaller::new()
        .with("search_issues", fixture("search_p1"))
        .with("search_issues", fixture("search_p2"))
        .with("get_issue_statuses", fixture("statuses"))
        .with("search_users", fixture("users"))
}

#[tokio::test]
async fn the_board_is_base_states_plus_custom_ones_before_closed() {
    let c = conn(board_fake().listing_tools(tools_except(&[])));
    let board = c.get_board("open-issues").await.expect("board");
    let names: Vec<&str> = board.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "New",
            "Waiting on You",
            "Waiting on Customer",
            "On Hold",
            "Escalated to Engineering",
            "Needs triage",
            "Closed"
        ],
        "statuses from get_issue_statuses (archived left out), then one found on a card"
    );
    let custom = &board.columns[4].statuses[0];
    assert_eq!(
        (custom.id.as_str(), custom.category.as_str()),
        ("escalated_to_eng", "indeterminate")
    );
    assert_eq!(board.columns[6].statuses[0].category, "done");
}

#[tokio::test]
async fn cards_are_the_window_with_recent_closed_ones() {
    let c = conn(board_fake().listing_tools(tools_except(&[])));
    let board = c.get_board("open-issues").await.expect("board");
    let keys: Vec<&str> = board.issues.iter().map(|i| i.key.as_str()).collect();
    assert_eq!(
        keys,
        ["#101", "#102", "#103"],
        "closed 20 days ago is dropped"
    );
    let a = &board.issues[0];
    assert_eq!(a.id, "iss-101");
    assert_eq!(
        a.description.as_deref(),
        Some("Clicking Export does nothing.")
    );
    let jo = a.assignee.as_ref().expect("assignee");
    assert_eq!(jo.display_name, "Jo Example", "named by search_users");
    assert_eq!(
        jo.avatar_url.as_deref(),
        Some("https://avatars.example.com/u-1.png")
    );
    let lee = board.issues[1].assignee.as_ref().expect("assignee");
    assert_eq!(lee.display_name, "Lee Example", "named on the issue");
    assert_eq!(board.issues[1].status_id, "needs_triage");
    assert_eq!(board.issues[1].reporter, None);
    assert_eq!(a.reporter.as_deref(), Some("customer@example.org"));
}

#[tokio::test]
async fn the_window_is_asked_for_as_a_filter_and_pages_follow_the_cursor() {
    let c = conn(board_fake().listing_tools(tools_except(&[])));
    c.get_board("open-issues").await.expect("board");
    let searches = c.caller().calls_to("search_issues");
    assert_eq!(searches.len(), 2);
    let filter: Value =
        serde_json::from_str(searches[0]["filter_json"].as_str().expect("JSON text"))
            .expect("filter JSON");
    assert_eq!(filter["field"], "created_at");
    assert_eq!(filter["operator"], "time_is_after");
    let since = chrono::DateTime::parse_from_rfc3339(filter["value"].as_str().expect("time"))
        .expect("RFC 3339");
    let days = (chrono::Utc::now() - since.with_timezone(&chrono::Utc)).num_days();
    assert!((29..=30).contains(&days), "30 days back, was {days}");
    assert_eq!(searches[0]["limit"], 200);
    assert_eq!(searches[0]["include_messages"], false);
    assert_eq!(searches[0].get("cursor"), None);
    assert_eq!(searches[1]["cursor"], "page-2");
    assert_eq!(searches[1]["filter_json"], searches[0]["filter_json"]);
}

#[tokio::test]
async fn without_a_filter_argument_it_reads_newest_first_to_the_windows_edge() {
    let mut tools = tools_except(&["search_issues"]);
    tools.push(ToolInfo {
        name: "search_issues".into(),
        description: String::new(),
        input_schema: json!({ "properties": { "cursor": {}, "sort": { "type": "array" } } }),
    });
    let old = json!({ "id": "x", "number": 9, "state": "new",
                      "created_at": (chrono::Utc::now() - chrono::Duration::days(40)).to_rfc3339() });
    let mut page1 = fixture("search_p1");
    page1["data"].as_array_mut().expect("list").push(old);
    let fake = FakeCaller::new()
        .with("search_issues", page1)
        .with("search_issues", fixture("search_p2"))
        .listing_tools(tools);
    let c = conn(fake);
    let board = c.get_board("open-issues").await.expect("board");
    let searches = c.caller().calls_to("search_issues");
    assert_eq!(searches.len(), 1, "page 1 reached past the window");
    assert_eq!(searches[0].get("filter_json"), None);
    assert_eq!(
        searches[0]["sort"],
        json!([{ "field": "created_at", "order": "desc" }])
    );
    assert!(
        board.issues.iter().all(|i| i.key != "#9"),
        "outside the window"
    );
}

#[tokio::test]
async fn a_rejected_filter_falls_back_to_reading_newest_first() {
    let fake = FakeCaller::new()
        .failing("search_issues", "unknown_operator")
        .listing_tools(tools_except(&[]));
    let c = conn(fake);
    let err = c.get_board("open-issues").await.err().expect("still fails");
    assert_eq!(err, "unknown_operator");
    let searches = c.caller().calls_to("search_issues");
    assert_eq!(searches.len(), 2, "filtered, then not");
    assert!(searches[0].get("filter_json").is_some());
    assert_eq!(searches[1].get("filter_json"), None);
}

#[tokio::test]
async fn without_get_issue_statuses_custom_ones_come_from_the_cards() {
    let fake = board_fake().listing_tools(tools_except(&["get_issue_statuses", "search_users"]));
    let c = conn(fake);
    let board = c.get_board("open-issues").await.expect("board");
    let names: Vec<&str> = board.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names[4..], ["Needs triage", "Closed"]);
    let jo = board.issues[0].assignee.as_ref().expect("assignee");
    assert_eq!(jo.display_name, "jo", "the email's local part, as on REST");
    assert!(c.caller().calls_to("get_issue_statuses").is_empty());
}

#[tokio::test]
async fn paging_is_capped() {
    let endless = json!({ "data": [{ "id": "i", "number": 1, "state": "new" }],
                          "pagination": { "cursor": "again", "has_next_page": true } });
    let fake = FakeCaller::new()
        .with("search_issues", endless)
        .listing_tools(tools_except(&[]));
    let c = conn(fake);
    c.get_board("open-issues").await.expect("board");
    assert_eq!(c.caller().calls_to("search_issues").len(), 10);
}

#[tokio::test]
async fn one_virtual_board_and_no_prs() {
    let c = conn(FakeCaller::new().listing_tools(tools_except(&[])));
    let boards = c.list_boards().await.expect("boards");
    assert_eq!(boards.len(), 1);
    assert_eq!(boards[0].id, "open-issues");
    assert!(c.get_board("other").await.is_err());
    assert!(c
        .get_pull_requests("#1", true)
        .await
        .expect("prs")
        .is_empty());
    assert!(
        c.caller().calls().is_empty(),
        "none of that reaches the server"
    );
}

#[tokio::test]
async fn current_user_and_the_session_say_mcp() {
    let fake = FakeCaller::new()
        .with("get_me", fixture("me"))
        .listing_tools(tools_except(&[]));
    let c = conn(fake);
    let me = c.current_user().await.expect("me");
    assert_eq!(
        (me.account_id.as_str(), me.display_name.as_str()),
        ("u-me", "Sam Example")
    );
    let s = c.session_info();
    assert_eq!(s.via, crate::issues::Via::Mcp);
    assert!(s.provider == crate::issues::ProviderKind::Pylon);
    assert_eq!(c.link().server_url, URL);
    assert_eq!(s.site.as_deref(), Some("mcp.eu.usepylon.com"));
}

#[tokio::test]
async fn missing_tools_are_named_in_one_sentence() {
    let fake = FakeCaller::new().listing_tools(tools_except(&["update_issue", "send_issue_note"]));
    let err = super::open(fake, URL).await.err().expect("missing tools");
    assert_eq!(
        err,
        "Pylon's MCP server doesn't offer update_issue, send_issue_note, \
         which trace's Pylon board needs."
    );
    let optional = FakeCaller::new().listing_tools(tools_except(&["search_users"]));
    assert!(
        super::open(optional, URL).await.is_ok(),
        "search_users is optional"
    );
}

#[test]
fn the_board_uses_mcp_only_without_api_credentials() {
    let link = McpLink {
        server_url: URL.into(),
        cloud_id: None,
        site_url: None,
        site_name: None,
    };
    let eu = |u: &str| u == URL;
    assert_eq!(
        pick(None::<()>, Some(link.clone()), eu),
        Some(Pick::Mcp(link.clone()))
    );
    assert_eq!(
        pick(Some("token"), Some(link.clone()), eu),
        Some(Pick::Api("token"))
    );
    assert_eq!(pick(None::<()>, Some(link), |_| false), None, "logged out");
}
