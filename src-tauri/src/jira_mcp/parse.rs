//! Atlassian MCP payloads → the shared `issues::models`.
//!
//! The tools that wrap Jira's REST API return its JSON as it is (seen on the
//! v1 server: `searchJiraIssuesUsingJql` gives `{ issues, nextPageToken,
//! isLast }` of REST issues; transitions are REST's), so issues, users and
//! comments go through `jira::parse`. The board tools' payloads aren't
//! documented: each reader here accepts REST's shape and the likely simplified
//! ones (a bare array or another list key, ids as numbers or strings, a status
//! category as a key or a name).

use std::collections::HashMap;

use serde_json::Value;

use crate::issues::models::{
    BoardColumn, BoardSummary, ColumnStatus, Issue, IssueComment, IssueUser,
};
use crate::jira::parse as rest;

/// A status id's name and category key.
pub type StatusMeta = HashMap<String, (String, String)>;

/// The items of a list payload: the value itself, or its first list under `keys`.
pub fn items<'a>(v: &'a Value, keys: &[&str]) -> &'a [Value] {
    if let Some(arr) = v.as_array() {
        return arr;
    }
    keys.iter()
        .find_map(|k| v.get(*k).and_then(Value::as_array))
        .map_or(&[], Vec::as_slice)
}

/// An id, sent as a string or a number.
pub fn id_of(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub fn text<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str))
}

/// The signed-in user: REST's `/myself` shape (`getJiraCurrentUser`) or the
/// profile `atlassianUserInfo` gives (`account_id`, `name`, `picture`).
pub fn user(v: &Value) -> IssueUser {
    if v.get("accountId").is_some() {
        return rest::parse_user(v);
    }
    IssueUser {
        account_id: text(v, &["account_id", "id"])
            .unwrap_or_default()
            .to_string(),
        display_name: text(v, &["name", "nickname", "displayName"])
            .unwrap_or("Unknown")
            .to_string(),
        email: text(v, &["email", "emailAddress"]).map(str::to_string),
        avatar_url: text(v, &["picture", "avatarUrl"]).map(str::to_string),
    }
}

/// One page of `listJiraBoards`.
pub fn boards(v: &Value) -> Vec<BoardSummary> {
    items(v, &["values", "boards", "results"])
        .iter()
        .filter_map(|b| {
            Some(BoardSummary {
                id: id_of(b.get("id").or_else(|| b.get("boardId")))?,
                name: text(b, &["name"])?.to_string(),
                board_type: text(b, &["type", "boardType"])
                    .unwrap_or("scrum")
                    .to_ascii_lowercase(),
            })
        })
        .collect()
}

/// A normalised status category key from a key (`new`) or a name (`To Do`,
/// `IN_PROGRESS`, `Done`).
fn category(v: Option<&Value>) -> Option<String> {
    let v = v?;
    let raw = v
        .as_str()
        .or_else(|| text(v, &["key", "name"]))?
        .to_ascii_lowercase()
        .replace(['_', ' '], "");
    Some(
        match raw.as_str() {
            "new" | "todo" | "undefined" => "new",
            "done" | "complete" => "done",
            _ => "indeterminate",
        }
        .to_string(),
    )
}

/// What a board is, from `getJiraBoardConfig`.
#[derive(Clone, Default)]
pub struct BoardConfig {
    pub name: Option<String>,
    pub board_type: Option<String>,
    /// In order, each with its statuses (names filled when the payload has them).
    pub columns: Vec<BoardColumn>,
    pub filter_id: Option<String>,
    /// The saved filter's JQL, when the tool gives it (else `filter = <id>`).
    pub filter_jql: Option<String>,
    pub sub_query: Option<String>,
    /// Statuses of a column flagged as the Kanban backlog.
    pub backlog_statuses: Vec<String>,
}

/// Read `getJiraBoardConfig`: REST's `{ columnConfig: { columns }, filter,
/// subQuery }`, possibly under `configuration`, or the columns at the top.
pub fn board_config(v: &Value) -> BoardConfig {
    let v = v.get("configuration").unwrap_or(v);
    let mut config = BoardConfig {
        name: text(v, &["name", "boardName"]).map(str::to_string),
        board_type: text(v, &["type", "boardType"]).map(str::to_ascii_lowercase),
        ..BoardConfig::default()
    };
    let columns = v
        .get("columnConfig")
        .map_or_else(|| items(v, &["columns"]), |c| items(c, &["columns"]));
    for col in columns {
        let Some(name) = text(col, &["name"]) else {
            continue;
        };
        let statuses: Vec<ColumnStatus> = items(col, &["statuses", "mappedStatuses"])
            .iter()
            .filter_map(|s| {
                let id = id_of(Some(s)).or_else(|| id_of(s.get("id")))?;
                Some(ColumnStatus {
                    name: text(s, &["name"]).unwrap_or(&id).to_string(),
                    category: category(s.get("statusCategory").or_else(|| s.get("category")))
                        .unwrap_or_else(|| "new".to_string()),
                    id,
                })
            })
            .collect();
        let flags = ["isKanPlanColumn", "isBacklog", "backlog"];
        if flags
            .iter()
            .any(|f| col.get(*f).and_then(Value::as_bool) == Some(true))
        {
            config
                .backlog_statuses
                .extend(statuses.iter().map(|s| s.id.clone()));
        }
        config.columns.push(BoardColumn {
            name: name.to_string(),
            statuses,
        });
    }
    let filter = v.get("filter");
    config.filter_id = id_of(
        filter
            .and_then(|f| f.get("id"))
            .or_else(|| v.get("filterId")),
    );
    config.filter_jql = filter
        .and_then(|f| text(f, &["jql", "query"]))
        .or_else(|| text(v, &["filterJql", "jql"]))
        .map(str::to_string);
    config.sub_query = v
        .get("subQuery")
        .and_then(|s| s.as_str().or_else(|| text(s, &["query"])))
        .map(str::to_string);
    config
}

/// `listJiraStatuses`: id → (name, category).
pub fn statuses(v: &Value) -> StatusMeta {
    items(v, &["values", "statuses", "results"])
        .iter()
        .filter_map(|s| {
            let id = id_of(s.get("id"))?;
            let name = text(s, &["name"])?.to_string();
            let cat = category(s.get("statusCategory")).unwrap_or_else(|| "new".into());
            Some((id, (name, cat)))
        })
        .collect()
}

/// One page of `searchJiraIssuesUsingJql`: its cards and the next page's token.
pub fn issue_page(v: &Value) -> (Vec<Issue>, Option<String>) {
    let issues = items(v, &["issues", "values", "results"])
        .iter()
        .filter_map(rest::parse_issue)
        .collect();
    let last = v.get("isLast").and_then(Value::as_bool) == Some(true);
    let next = text(v, &["nextPageToken"])
        .filter(|t| !t.is_empty() && !last)
        .map(str::to_string);
    (issues, next)
}

/// The running sprint's name in `listJiraBoardSprints` (asked for active ones).
pub fn active_sprint(v: &Value) -> Option<String> {
    let sprints = items(v, &["values", "sprints", "results"]);
    let active = sprints
        .iter()
        .find(|s| text(s, &["state"]).is_none_or(|st| st.eq_ignore_ascii_case("active")))?;
    // A nameless sprint is still a sprint: the board scopes to it.
    Some(text(active, &["name"]).unwrap_or_default().to_string())
}

/// An available transition: its id and the status it lands on.
pub struct Transition {
    pub id: String,
    pub to_id: String,
    pub to_name: String,
}

pub fn transitions(v: &Value) -> Vec<Transition> {
    items(v, &["transitions", "values"])
        .iter()
        .filter_map(|t| {
            let to = t.get("to").or_else(|| t.get("toStatus"));
            Some(Transition {
                id: id_of(t.get("id"))?,
                to_id: id_of(to.and_then(|s| s.get("id")).or_else(|| t.get("toStatusId")))?,
                to_name: to
                    .and_then(|s| text(s, &["name"]))
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect()
}

/// Comments from `listJiraIssueComments` or `getJiraIssue`'s comment field,
/// oldest first.
pub fn comments(v: &Value) -> Vec<IssueComment> {
    let field = v.get("fields").and_then(|f| f.get("comment"));
    let list = match field {
        Some(f) => items(f, &["comments"]),
        None => items(v, &["comments", "values", "results"]),
    };
    let mut out: Vec<IssueComment> = list.iter().filter_map(rest::parse_comment).collect();
    if out.iter().all(|c| c.created.is_some()) {
        out.sort_by(|a, b| a.created.cmp(&b.created));
    }
    out
}

/// An issue's status category key, from `getJiraIssue`.
pub fn status_category(v: &Value) -> Option<String> {
    let status = v.get("fields")?.get("status")?;
    category(status.get("statusCategory"))
}

#[cfg(test)]
#[path = "parse_tests.rs"]
mod tests;
