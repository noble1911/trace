//! What a Jira board actually shows.
//!
//! A board's saved filter is not its board view. Jira also applies:
//!
//! - **Scrum:** only open sprints — but a board between sprints shows its filter,
//!   not an empty board.
//! - **Kanban:** the sub-filter (`subQuery`, typically unreleased versions), and
//!   the backlog column, which lives on Jira's separate Backlog screen.
//! - **Both:** "hide completed issues older than", the board's done cutoff.
//!
//! The last two settings aren't in the public Agile API, so we read the same
//! board-config screen Jira's own UI uses (`rapidviewconfig/editmodel.json`) and
//! fall back to Jira's defaults per board type when it isn't available (it needs
//! board-admin rights). Checked against a real Kanban board: the JQL built here
//! returned exactly the 205 issues the board itself rendered.

use serde_json::Value;

use super::client;
use super::JiraConnection;
use crate::issues::models::BoardColumn;

/// Jira's own defaults for "hide completed issues older than", used when the
/// board's configured value can't be read. Scrum boards don't hide any.
const DEFAULT_CUTOFF_KANBAN: &str = "-2w";
const DEFAULT_CUTOFF_TEAM_MANAGED: &str = "-14d";

/// The board settings that decide what it shows, beyond its saved filter.
pub struct BoardSettings {
    /// "hide completed issues older than", as JQL-ready relative time ("-1w").
    /// `None` = show every completed issue ("Never mind, show all", and Scrum).
    pub done_cutoff: Option<String>,
    /// Statuses of the Kanban backlog column — on the Backlog screen, not the board.
    pub backlog_statuses: Vec<String>,
    /// Whether this board runs sprints.
    pub sprint_support: bool,
}

impl BoardSettings {
    /// What Jira would do with a board whose config screen we can't read.
    fn defaults(board_type: &str) -> Self {
        let done_cutoff = match board_type {
            "scrum" => None,
            "simple" => Some(DEFAULT_CUTOFF_TEAM_MANAGED.to_string()),
            _ => Some(DEFAULT_CUTOFF_KANBAN.to_string()),
        };
        Self {
            done_cutoff,
            backlog_statuses: Vec::new(),
            sprint_support: board_type == "scrum",
        }
    }
}

/// Read the board's config screen. Best effort: any failure (no board-admin
/// rights, a Jira flavour without the endpoint, unexpected JSON) falls back to
/// Jira's defaults for that board type rather than failing the board.
pub async fn fetch_settings(
    conn: &JiraConnection,
    board_id: i64,
    board_type: &str,
) -> BoardSettings {
    let id = board_id.to_string();
    let Ok(v) = client::get_query(
        conn,
        "/rest/greenhopper/1.0/rapidviewconfig/editmodel.json",
        &[("rapidViewId", id.as_str())],
    )
    .await
    else {
        return BoardSettings::defaults(board_type);
    };
    let mut settings = BoardSettings::defaults(board_type);
    // "NONE" is the board's "show all"; anything else is a JQL relative time.
    if let Some(cutoff) = v.get("oldDoneIssuesCutoff").and_then(Value::as_str) {
        settings.done_cutoff = (cutoff != "NONE").then(|| cutoff.to_string());
    }
    if let Some(sprints) = v.get("isSprintSupportEnabled").and_then(Value::as_bool) {
        settings.sprint_support = sprints;
    }
    settings.backlog_statuses = backlog_statuses(&v);
    settings
}

/// Statuses mapped to the backlog column (`isKanPlanColumn`), which Jira shows
/// on the Backlog screen rather than the board.
fn backlog_statuses(edit_model: &Value) -> Vec<String> {
    edit_model
        .get("rapidListConfig")
        .and_then(|c| c.get("mappedColumns"))
        .and_then(Value::as_array)
        .map(|columns| {
            columns
                .iter()
                .filter(|col| {
                    col.get("isKanPlanColumn")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .filter_map(|col| col.get("mappedStatuses").and_then(Value::as_array))
                .flatten()
                .filter_map(|status| status.get("id"))
                .filter_map(|id| {
                    id.as_str()
                        .map(str::to_string)
                        .or_else(|| Some(id.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The columns a board renders: its configured ones without the backlog column,
/// and without any column no status maps to (they can never hold a card).
pub fn visible_columns(columns: Vec<BoardColumn>, backlog_statuses: &[String]) -> Vec<BoardColumn> {
    columns
        .into_iter()
        .filter(|col| {
            !col.statuses.is_empty()
                && !col
                    .statuses
                    .iter()
                    .all(|s| backlog_statuses.contains(&s.id))
        })
        .collect()
}

/// Build the JQL for exactly what the board shows (no `ORDER BY`).
///
/// `open_sprint` says whether the board has one right now: a Scrum board between
/// sprints falls back to its filter, because an empty board is never the answer.
pub fn board_jql(
    filter: Option<&str>,
    sub_query: Option<&str>,
    settings: &BoardSettings,
    open_sprint: bool,
) -> String {
    let mut clauses: Vec<String> = Vec::new();
    if let Some(filter) = filter.map(str::trim).filter(|f| !f.is_empty()) {
        clauses.push(format!("({filter})"));
    }
    if let Some(sub) = sub_query.map(str::trim).filter(|s| !s.is_empty()) {
        clauses.push(format!("({sub})"));
    }
    if settings.sprint_support && open_sprint {
        clauses.push("sprint in openSprints()".to_string());
    }
    if !settings.backlog_statuses.is_empty() {
        let ids = settings
            .backlog_statuses
            .iter()
            .map(|id| format!("\"{id}\""))
            .collect::<Vec<_>>()
            .join(", ");
        clauses.push(format!("status not in ({ids})"));
    }
    if let Some(cutoff) = &settings.done_cutoff {
        // Mirrors the board's "hide completed issues older than": anything not
        // finished stays, anything finished must be recent.
        clauses.push(format!(
            "(statusCategory != Done OR statusCategoryChangedDate >= {cutoff})"
        ));
    }
    // Nothing configured at all — every issue the user can see would be too
    // much, so scope to the (impossible) empty set rather than the instance.
    if clauses.is_empty() {
        return "issuekey = NULL".to_string();
    }
    clauses.join(" AND ")
}

/// The running sprint's name, if the board has one. `None` also means "show the
/// board's filter instead of nothing" for a Scrum board between sprints.
pub async fn open_sprint_name(conn: &JiraConnection, board_id: i64) -> Option<String> {
    let path = format!("/rest/agile/1.0/board/{board_id}/sprint");
    let v = client::get_query(conn, &path, &[("state", "active"), ("maxResults", "1")])
        .await
        .ok()?;
    let first = v.get("values").and_then(Value::as_array)?.first()?;
    first
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        // A nameless sprint is still a sprint — don't fall back to the filter.
        .or_else(|| Some(String::new()))
}

#[cfg(test)]
mod tests {
    use super::{backlog_statuses, board_jql, visible_columns, BoardSettings};
    use crate::issues::models::{BoardColumn, ColumnStatus};

    fn settings(cutoff: Option<&str>, backlog: &[&str], sprints: bool) -> BoardSettings {
        BoardSettings {
            done_cutoff: cutoff.map(str::to_string),
            backlog_statuses: backlog.iter().map(|s| s.to_string()).collect(),
            sprint_support: sprints,
        }
    }

    #[test]
    fn kanban_board_scopes_to_what_it_shows() {
        // The real PM Delivery board: filter + sub-filter, no backlog, 1-week cutoff.
        let jql = board_jql(
            Some("project = PM AND type != Epic"),
            Some("fixVersion in unreleasedVersions() OR fixVersion is EMPTY"),
            &settings(Some("-1w"), &["10039"], false),
            false,
        );
        assert_eq!(
            jql,
            "(project = PM AND type != Epic) AND (fixVersion in unreleasedVersions() OR fixVersion is EMPTY) \
             AND status not in (\"10039\") AND (statusCategory != Done OR statusCategoryChangedDate >= -1w)"
        );
    }

    #[test]
    fn scrum_uses_open_sprints_only_while_one_runs() {
        let scrum = settings(None, &[], true);
        let running = board_jql(Some("project = IT"), None, &scrum, true);
        assert_eq!(running, "(project = IT) AND sprint in openSprints()");
        // Between sprints the board shows its filter, not an empty board.
        let between = board_jql(Some("project = IT"), None, &scrum, false);
        assert_eq!(between, "(project = IT)");
    }

    #[test]
    fn a_board_with_nothing_configured_stays_empty() {
        assert_eq!(
            board_jql(None, None, &settings(None, &[], false), true),
            "issuekey = NULL"
        );
    }

    #[test]
    fn defaults_follow_the_board_type() {
        assert_eq!(BoardSettings::defaults("scrum").done_cutoff, None);
        assert!(BoardSettings::defaults("scrum").sprint_support);
        assert_eq!(
            BoardSettings::defaults("kanban").done_cutoff.as_deref(),
            Some("-2w")
        );
        assert_eq!(
            BoardSettings::defaults("simple").done_cutoff.as_deref(),
            Some("-14d")
        );
        assert!(!BoardSettings::defaults("kanban").sprint_support);
    }

    #[test]
    fn backlog_column_and_empty_columns_are_dropped() {
        let column = |name: &str, ids: &[&str]| BoardColumn {
            name: name.to_string(),
            statuses: ids
                .iter()
                .map(|id| ColumnStatus {
                    id: id.to_string(),
                    name: id.to_string(),
                    category: "new".to_string(),
                })
                .collect(),
        };
        let columns = vec![
            column("Backlog", &["10039"]),
            column("Unmapped", &[]),
            column("To Do", &["10248"]),
        ];
        let kept: Vec<String> = visible_columns(columns, &["10039".to_string()])
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(kept, vec!["To Do".to_string()]);
    }

    #[test]
    fn reads_backlog_statuses_from_the_board_config() {
        let model = serde_json::json!({
            "rapidListConfig": { "mappedColumns": [
                { "name": "Backlog", "isKanPlanColumn": true, "mappedStatuses": [{ "id": "10039" }] },
                { "name": "To Do", "isKanPlanColumn": false, "mappedStatuses": [{ "id": "10248" }] },
            ]}
        });
        assert_eq!(backlog_statuses(&model), vec!["10039".to_string()]);
        // A board without the flag (or the endpoint) simply has no backlog.
        assert!(backlog_statuses(&serde_json::json!({})).is_empty());
    }
}
