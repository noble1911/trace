//! Arguments shaped by advertised schemas; the connect check.
use super::*;
use crate::mcp_client::args::Arg;
use serde_json::json;

fn tool(name: &str, schema: Value) -> ToolInfo {
    ToolInfo {
        name: name.into(),
        description: String::new(),
        input_schema: schema,
    }
}

fn all_listed() -> Vec<ToolInfo> {
    ALL.iter()
        .map(|op| tool(op.names[0], json!({ "type": "object" })))
        .collect()
}

#[test]
fn arguments_take_the_names_and_types_the_schema_lists() {
    let mut tools = all_listed();
    tools.push(tool(
        "board",
        json!({ "properties": { "board_id": { "type": "integer" },
                                "fields": { "type": "string" } } }),
    ));
    let set = Toolset::from_list(tools).expect("toolset");
    let args = set.args(
        "board",
        vec![
            Arg::must(vec![("boardId", json!("42")), ("board_id", json!("42"))]),
            Arg::opt(vec![("fields", json!(["summary", "status"]))]),
            Arg::opt(vec![("maxResults", json!(50))]),
            Arg::need("cloudId", json!("c1")),
        ],
    );
    assert_eq!(
        args,
        json!({ "board_id": 42, "fields": "summary,status", "cloudId": "c1" })
    );
}

#[test]
fn with_no_schema_every_argument_goes_under_its_first_name() {
    let set = Toolset::from_list(all_listed()).expect("toolset");
    let args = set.args(
        "listJiraBoards",
        vec![
            Arg::opt(vec![("startAt", json!(0))]),
            Arg::must(vec![("boardId", json!(1)), ("id", json!(1))]),
        ],
    );
    assert_eq!(args, json!({ "startAt": 0, "boardId": 1 }));
}

#[test]
fn missing_tools_are_named_in_one_sentence() {
    let tools = vec![tool("getAccessibleAtlassianResources", json!({}))];
    let err = Toolset::from_list(tools).err().expect("missing tools");
    assert!(err.starts_with("Atlassian's MCP server doesn't offer "));
    assert!(err.contains("listJiraBoards") && err.contains("getJiraBoardConfig"));
    assert!(
        !err.contains("getTeamworkGraphContext"),
        "optional ones aren't"
    );
}

#[test]
fn a_v1_name_stands_in_for_a_v2_one() {
    let tools: Vec<ToolInfo> = all_listed()
        .into_iter()
        .filter(|t| t.name != "listJiraIssueTransitions")
        .chain([tool("getTransitionsForJiraIssue", json!({}))])
        .collect();
    let set = Toolset::from_list(tools).expect("toolset");
    assert_eq!(set.name(&TRANSITIONS), Some("getTransitionsForJiraIssue"));
}
