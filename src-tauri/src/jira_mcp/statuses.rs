//! Naming each column's statuses and saying what they mean (`new` |
//! `indeterminate` | `done`), which decides auto-start's column and what counts
//! as finished. A status trace can't place is never given a made-up category.
//!
//! The rule, in order of trust, for a status of a board column:
//! 1. what the board's config says about it;
//! 2. the site's statuses (`listJiraStatuses`, when the server offers it);
//! 3. a card on the board in that status;
//! 4. for a column where none of that placed any status: one issue anywhere on
//!    the site in it (`status = <id>`, one result, cached);
//! 5. a status still unknown in a column with a known one takes that column's
//!    category (no issue on the site is in it, so it only matters through its
//!    column) and its id as its name.
//!
//! A column none of whose statuses can be placed fails the board load with a
//! sentence naming them: showing it with a guessed meaning could auto-start
//! agents in the wrong column or treat unfinished work as done.

use serde_json::json;

use super::parse::{self, StatusMeta};
use super::tools::{self};
use super::JiraMcp;
use crate::issues::models::{BoardColumn, Issue};
use crate::mcp_client::args::Arg;
use crate::mcp_client::ToolCaller;

/// The most single-status lookups one board load makes (step 4).
const MAX_LOOKUPS: usize = 10;

/// The site's statuses (cached; empty when the server has no status tool, or
/// its call failed: the other steps then place them).
pub async fn site_statuses<T: ToolCaller>(c: &JiraMcp<T>) -> StatusMeta {
    if let Some(meta) = c.inner.statuses.get("all") {
        return meta;
    }
    if !c.offers(&tools::STATUSES).await {
        return StatusMeta::new();
    }
    // v2 requires `mode`: `site` lists every status on the site.
    let args = vec![
        c.cloud(),
        Arg::opt(vec![("mode", json!("site"))]),
        Arg::opt(vec![("maxResults", json!(200))]),
    ];
    let meta = match c.call(&tools::STATUSES, args).await {
        Ok(v) => parse::statuses(&v),
        Err(_) => StatusMeta::new(),
    };
    if !meta.is_empty() {
        c.inner.statuses.put("all".into(), meta.clone());
    }
    meta
}

/// What the statuses `ids` are called, for matching a move to its target:
/// the server lists a move's target by name, not id. From the site's list,
/// then one lookup per id it doesn't have (a team-managed project's statuses
/// aren't in the site list). An id nothing names is left out.
pub async fn names<T: ToolCaller>(c: &JiraMcp<T>, ids: &[String]) -> Vec<String> {
    if !c.offers(&tools::STATUSES).await {
        return Vec::new();
    }
    let ask = |extra: Vec<Arg>| async {
        let mut args = vec![c.cloud()];
        args.extend(extra);
        c.call(&tools::STATUSES, args).await.ok()
    };
    let site = ask(vec![Arg::need("mode", json!("site"))]).await;
    let mut known = site.as_ref().map(parse::status_names).unwrap_or_default();
    let missing: Vec<&String> = ids.iter().filter(|id| !known.contains_key(*id)).collect();
    for id in missing.into_iter().take(MAX_LOOKUPS) {
        let one = ask(vec![
            Arg::need("mode", json!("status")),
            Arg::need("statusIdOrName", json!(id)),
        ])
        .await;
        if let Some(found) = one.as_ref().map(parse::status_names) {
            known.extend(found.into_iter().filter(|(k, _)| k == id));
        }
    }
    ids.iter().filter_map(|id| known.get(id).cloned()).collect()
}

/// Steps 1–3: fill in what the config, the site's list and the cards say.
pub fn fill(columns: &mut [BoardColumn], meta: &StatusMeta, issues: &[Issue]) {
    for status in columns.iter_mut().flat_map(|c| c.statuses.iter_mut()) {
        let known = meta.get(&status.id).cloned().or_else(|| {
            let card = issues.iter().find(|i| i.status_id == status.id)?;
            Some((card.status_name.clone(), card.status_category.clone()))
        });
        let Some((name, category)) = known else {
            continue;
        };
        if status.name.is_empty() {
            status.name = name;
        }
        if status.category.is_empty() {
            status.category = category;
        }
    }
}

/// The statuses of columns where no status is placed yet: step 4's lookups.
pub fn unplaced(columns: &[BoardColumn]) -> Vec<String> {
    columns
        .iter()
        .filter(|c| c.statuses.iter().all(|s| s.category.is_empty()))
        .flat_map(|c| c.statuses.iter().map(|s| s.id.clone()))
        .collect()
}

/// Step 4: one issue anywhere on the site in each of `ids`, for its status's
/// name and category. Best effort per status: a failed or empty search leaves
/// it unknown, and [`finish`] says so.
pub async fn look_up<T: ToolCaller>(c: &JiraMcp<T>, ids: &[String]) -> StatusMeta {
    let mut found = StatusMeta::new();
    for id in ids.iter().take(MAX_LOOKUPS) {
        let cache_key = format!("status:{id}");
        if let Some(meta) = c.inner.statuses.get(&cache_key) {
            found.extend(meta);
            continue;
        }
        let args = vec![
            c.cloud(),
            Arg::need("jql", json!(format!("status = {id}"))),
            Arg::opt(vec![("fields", json!(["summary", "status"]))]),
            Arg::opt(vec![("maxResults", json!(1))]),
        ];
        let Ok(v) = c.call(&tools::SEARCH, args).await else {
            continue;
        };
        let Ok((issues, _)) = parse::issue_page(&v) else {
            continue;
        };
        // Only an issue really in that status says what it is.
        if let Some(i) = issues.iter().find(|i| &i.status_id == id) {
            let meta = StatusMeta::from([(
                id.clone(),
                (i.status_name.clone(), i.status_category.clone()),
            )]);
            c.inner.statuses.put(cache_key, meta.clone());
            found.extend(meta);
        }
    }
    found
}

/// Step 5, then the check: every status named (its id when nothing else) and
/// placed, or Err naming the columns that couldn't be.
pub fn finish(mut columns: Vec<BoardColumn>) -> Result<Vec<BoardColumn>, String> {
    let mut unknown: Vec<String> = Vec::new();
    for col in &mut columns {
        let placed = col
            .statuses
            .iter()
            .find(|s| !s.category.is_empty())
            .map(|s| s.category.clone());
        for status in &mut col.statuses {
            if status.name.is_empty() {
                status.name = status.id.clone();
            }
            match &placed {
                Some(category) if status.category.is_empty() => status.category = category.clone(),
                Some(_) => {}
                None => unknown.push(format!("{} ({})", status.id, col.name)),
            }
        }
    }
    if unknown.is_empty() {
        return Ok(columns);
    }
    Err(format!(
        "Atlassian's MCP server didn't say what status {} means, and no issue on the site is \
         in it, so trace can't tell what its column is for.",
        unknown.join(", ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::issues::models::ColumnStatus;

    fn col(name: &str, statuses: &[(&str, &str)]) -> BoardColumn {
        BoardColumn {
            name: name.into(),
            statuses: statuses
                .iter()
                .map(|(id, category)| ColumnStatus {
                    id: id.to_string(),
                    name: String::new(),
                    category: category.to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn the_sites_list_beats_the_cards_and_the_config_beats_both() {
        let mut columns = vec![col("Doing", &[("3", ""), ("4", "done")])];
        let meta = StatusMeta::from([
            (
                "3".to_string(),
                ("Doing".to_string(), "indeterminate".to_string()),
            ),
            ("4".to_string(), ("Shipped".to_string(), "new".to_string())),
        ]);
        fill(&mut columns, &meta, &[]);
        let s = &columns[0].statuses;
        assert_eq!(
            (s[0].name.as_str(), s[0].category.as_str()),
            ("Doing", "indeterminate")
        );
        assert_eq!(
            (s[1].name.as_str(), s[1].category.as_str()),
            ("Shipped", "done")
        );
    }

    #[test]
    fn only_columns_with_nothing_placed_are_looked_up() {
        let columns = vec![
            col("Doing", &[("3", "indeterminate"), ("9", "")]),
            col("QA", &[("7", ""), ("8", "")]),
        ];
        assert_eq!(unplaced(&columns), ["7", "8"]);
    }

    #[test]
    fn an_unknown_status_takes_its_columns_meaning_and_its_id_as_name() {
        let columns = vec![col("Doing", &[("3", "indeterminate"), ("9", "")])];
        let done = finish(columns).expect("placed");
        assert_eq!(done[0].statuses[1].category, "indeterminate");
        assert_eq!(done[0].statuses[1].name, "9");
    }

    #[test]
    fn a_column_nothing_can_place_fails_the_board_naming_it() {
        let columns = vec![
            col("Doing", &[("3", "indeterminate")]),
            col("QA", &[("7", "")]),
        ];
        let err = finish(columns).err().expect("unplaceable");
        assert!(err.contains("status 7 (QA) means"), "{err}");
    }
}
