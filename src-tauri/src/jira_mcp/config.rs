//! `getJiraBoardConfig` → what a board is: its columns (each with its statuses),
//! its saved filter, sub-filter and Kanban backlog column.
//!
//! A board read from a config trace only half understood would be silently
//! wrong: no filter makes the search every issue the login can see, no columns
//! an empty board. So [`BoardConfig::filter`] refuses both, with one sentence.

use serde_json::Value;

use super::parse::{category, id_of, items, text};
use crate::issues::models::{BoardColumn, ColumnStatus};

/// What a board is, from `getJiraBoardConfig`.
#[derive(Clone, Default)]
pub struct BoardConfig {
    pub name: Option<String>,
    pub board_type: Option<String>,
    /// In order, each with its statuses. A status's name and category are what
    /// the payload said, and empty when it said nothing: `statuses::label` fills
    /// them in before a board is shown, so an unknown one is never guessed.
    pub columns: Vec<BoardColumn>,
    pub filter_id: Option<String>,
    /// The saved filter's JQL, when the tool gives it (else `filter = <id>`).
    pub filter_jql: Option<String>,
    pub sub_query: Option<String>,
    /// Statuses of a column flagged as the Kanban backlog.
    pub backlog_statuses: Vec<String>,
}

impl BoardConfig {
    /// The board's saved filter as JQL: its own text, else `filter = <id>`.
    /// Err (one sentence) when the config gives no filter or no column with a
    /// status: searching without the filter would show every issue the login
    /// can see, and a board without columns would look empty rather than broken.
    pub fn filter(&self) -> Result<String, String> {
        let filter = self
            .filter_jql
            .as_deref()
            .map(str::trim)
            .filter(|f| !f.is_empty())
            .map(str::to_string)
            .or_else(|| self.filter_id.as_ref().map(|id| format!("filter = {id}")));
        let has_columns = self.columns.iter().any(|c| !c.statuses.is_empty());
        let missing = match (&filter, has_columns) {
            (Some(f), true) => return Ok(f.clone()),
            (None, true) => "no filter",
            (Some(_), false) => "no columns",
            (None, false) => "no filter or columns",
        };
        Err(format!(
            "Atlassian's MCP server returned a board configuration trace couldn't read ({missing})."
        ))
    }
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
                    name: text(s, &["name"]).unwrap_or_default().to_string(),
                    category: category(s.get("statusCategory").or_else(|| s.get("category")))
                        .unwrap_or_default(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_simplified_board_config_reads_too() {
        let v = json!({ "configuration": {
            "filterId": 77, "subQuery": "component = UI",
            "columns": [
                { "name": "Backlog", "isBacklog": true, "statuses": ["1"] },
                { "name": "Doing", "statuses": [{ "id": 3, "name": "Doing", "statusCategory": "IN_PROGRESS" }] },
            ] } });
        let c = board_config(&v);
        assert_eq!(c.filter_id.as_deref(), Some("77"));
        assert_eq!(c.sub_query.as_deref(), Some("component = UI"));
        assert_eq!(c.backlog_statuses, ["1"]);
        let doing = &c.columns[1].statuses[0];
        assert_eq!((doing.id.as_str(), doing.name.as_str()), ("3", "Doing"));
        assert_eq!(doing.category, "indeterminate");
        let bare = &c.columns[0].statuses[0];
        assert_eq!(
            (bare.name.as_str(), bare.category.as_str()),
            ("", ""),
            "unknown, not guessed"
        );
        assert_eq!(c.filter(), Ok("filter = 77".to_string()));
    }

    #[test]
    fn a_config_without_a_filter_or_columns_is_refused() {
        let columns = json!([{ "name": "To Do", "statuses": [{ "id": "1" }] }]);
        let no_filter = board_config(&json!({ "columns": columns }));
        assert_eq!(
            no_filter.filter(),
            Err(
                "Atlassian's MCP server returned a board configuration trace couldn't \
                 read (no filter)."
                    .to_string()
            )
        );
        let no_columns = board_config(&json!({ "filter": { "id": 5 }, "columns": [] }));
        assert!(no_columns
            .filter()
            .is_err_and(|e| e.ends_with("(no columns).")));
        let blank_jql = board_config(&json!({ "filter": { "jql": "  " } }));
        assert!(blank_jql
            .filter()
            .is_err_and(|e| e.ends_with("(no filter or columns).")));
        let jql = board_config(&json!({ "filterJql": "project = X", "columns": columns }));
        assert_eq!(jql.filter(), Ok("project = X".to_string()));
    }
}
