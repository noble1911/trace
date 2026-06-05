//! Board + sprint logic. Columns come from the board's configuration; cards from
//! the active sprint (or the board itself for Kanban). See `.claude/rules/jira.md`.

use serde_json::{json, Value};

use std::collections::HashMap;

use super::client;
use super::models::{
    parse_issue, BoardColumn, BoardData, BoardSummary, ColumnStatus, Issue, Transition,
};
use super::JiraConnection;

const ISSUE_FIELDS: &str =
    "summary,status,priority,issuetype,labels,assignee,description,reporter,epic";

/// List boards visible to the user (first page).
pub async fn list_boards(conn: &JiraConnection) -> Result<Vec<BoardSummary>, String> {
    let v = client::get_query(conn, "/rest/agile/1.0/board", &[("maxResults", "50")]).await?;
    let values = v.get("values").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(values
        .iter()
        .filter_map(|b| {
            Some(BoardSummary {
                id: b.get("id")?.as_i64()?,
                name: b.get("name")?.as_str()?.to_string(),
                board_type: b.get("type").and_then(Value::as_str).unwrap_or("scrum").to_string(),
            })
        })
        .collect())
}

struct BoardConfig {
    columns: Vec<BoardColumn>,
    /// The board's saved filter id — used to scope the issue search to exactly
    /// what this board shows (without the Agile view's epic exclusion).
    filter_id: Option<String>,
}

/// The board's configured columns (in order, with their status ids) and filter id.
async fn board_config(conn: &JiraConnection, board_id: i64) -> Result<BoardConfig, String> {
    let path = format!("/rest/agile/1.0/board/{board_id}/configuration");
    let v = client::get(conn, &path).await?;
    let columns = v
        .get("columnConfig")
        .and_then(|c| c.get("columns"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|col| {
            let name = col.get("name")?.as_str()?.to_string();
            // columnConfig statuses carry only an id; names are filled in later
            // from the status-name map (see `get_board`).
            let statuses = col
                .get("statuses")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| s.get("id").and_then(Value::as_str))
                        .map(|id| ColumnStatus { id: id.to_string(), name: id.to_string() })
                        .collect()
                })
                .unwrap_or_default();
            Some(BoardColumn { name, statuses })
        })
        .collect();
    let filter_id = v
        .get("filter")
        .and_then(|f| f.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(BoardConfig { columns, filter_id })
}

/// id → display name for every status in the instance, so a column's statuses
/// (which arrive as bare ids) can be labelled — including empty ones. Best
/// effort: returns whatever it can, names fall back to the id.
async fn fetch_status_names(conn: &JiraConnection) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Ok(v) = client::get(conn, "/rest/api/3/status").await {
        if let Some(arr) = v.as_array() {
            for s in arr {
                if let (Some(id), Some(name)) =
                    (s.get("id").and_then(Value::as_str), s.get("name").and_then(Value::as_str))
                {
                    map.insert(id.to_string(), name.to_string());
                }
            }
        }
    }
    map
}

/// The JQL of the board's saved filter, with any trailing `ORDER BY` stripped so
/// we can safely AND it with our own clauses.
async fn board_filter_jql(conn: &JiraConnection, filter_id: &str) -> Option<String> {
    let path = format!("/rest/api/3/filter/{filter_id}");
    let v = client::get(conn, &path).await.ok()?;
    let jql = v.get("jql")?.as_str()?;
    let base = match jql.to_uppercase().find(" ORDER BY ") {
        Some(idx) => &jql[..idx],
        None => jql,
    };
    let trimmed = base.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The current user's issues on this board that are in an open sprint.
///
/// We use the Platform search API (not the Agile board endpoint) because the
/// Agile endpoint hides epics. To still scope to "this board", we AND the board's
/// saved filter onto the query. `sprint in openSprints()` excludes the backlog
/// and completed sprints, so issues demoted back to the backlog don't show.
async fn fetch_my_issues(
    conn: &JiraConnection,
    board_filter: Option<&str>,
) -> Result<Vec<Issue>, String> {
    let mut jql = String::new();
    if let Some(bf) = board_filter {
        jql.push_str(&format!("({bf}) AND "));
    }
    jql.push_str("assignee = currentUser() AND sprint in openSprints() ORDER BY Rank ASC");

    let v = client::get_query(
        conn,
        "/rest/api/3/search/jql",
        &[("jql", jql.as_str()), ("fields", ISSUE_FIELDS), ("maxResults", "200")],
    )
    .await?;
    let issues = v.get("issues").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(issues.iter().filter_map(parse_issue).collect())
}

/// Assemble the board: columns from its configuration, cards = the current
/// user's open-sprint issues on the board, grouped into those columns by status.
pub async fn get_board(conn: &JiraConnection, board_id: i64) -> Result<BoardData, String> {
    let config = board_config(conn, board_id).await?;
    let mut columns = config.columns;

    // Resolve the board's saved filter so the search mirrors the board's scope.
    let board_filter = match &config.filter_id {
        Some(id) => board_filter_jql(conn, id).await,
        None => None,
    };
    let issues = fetch_my_issues(conn, board_filter.as_deref()).await?;

    // Label each column's statuses. Prefer the instance status map (covers empty
    // statuses); fall back to names carried on the issues themselves.
    let mut names = fetch_status_names(conn).await;
    for issue in &issues {
        names.entry(issue.status_id.clone()).or_insert_with(|| issue.status_name.clone());
    }
    for col in &mut columns {
        for status in &mut col.statuses {
            if let Some(name) = names.get(&status.id) {
                status.name = name.clone();
            }
        }
    }

    let board_name = list_boards(conn)
        .await
        .ok()
        .and_then(|bs| bs.into_iter().find(|b| b.id == board_id))
        .map(|b| b.name)
        .unwrap_or_else(|| format!("Board {board_id}"));

    Ok(BoardData {
        board_id,
        board_name,
        sprint_name: None,
        columns,
        issues,
    })
}

/// Available transitions for an issue (each carries its target status).
pub async fn list_transitions(conn: &JiraConnection, key: &str) -> Result<Vec<Transition>, String> {
    let path = format!("/rest/api/3/issue/{key}/transitions");
    let v = client::get(conn, &path).await?;
    let transitions = v.get("transitions").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(transitions
        .iter()
        .filter_map(|t| {
            Some(Transition {
                id: t.get("id")?.as_str()?.to_string(),
                name: t.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                to_status_id: t.get("to")?.get("id")?.as_str()?.to_string(),
                to_status_name: t
                    .get("to")
                    .and_then(|to| to.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect())
}

/// Transition an issue so it lands on any of `target_status_ids` (a column can
/// map to several statuses). Errors if no transition leads to any of them —
/// Jira workflows don't always allow every move.
pub async fn transition_to_status(
    conn: &JiraConnection,
    key: &str,
    target_status_ids: &[String],
) -> Result<(), String> {
    let transitions = list_transitions(conn, key).await?;
    let chosen = transitions
        .iter()
        .find(|t| target_status_ids.iter().any(|id| id == &t.to_status_id));

    let Some(chosen) = chosen else {
        // Name where the issue *can* go so the UI message is actionable rather
        // than a dead end — Jira workflows gate which jumps are legal.
        let allowed = transitions
            .iter()
            .map(|t| t.to_status_name.as_str())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(if allowed.is_empty() {
            format!("{key} has no available transitions from its current status.")
        } else {
            format!("Jira's workflow won't move {key} there directly. Allowed from here: {allowed}.")
        });
    };

    let path = format!("/rest/api/3/issue/{key}/transitions");
    client::post(conn, &path, json!({ "transition": { "id": chosen.id } })).await?;
    Ok(())
}
