//! The readers on the shapes the board tools might send besides REST's.

use serde_json::json;

use super::*;
use crate::jira_mcp::site::{choose, sites};

#[test]
fn a_site_listed_per_product_is_one_site() {
    let v = json!({ "resources": [
        { "id": "a", "url": "https://a.atlassian.net", "name": "a", "scopes": ["read:jira-work"] },
        { "id": "a", "url": "https://a.atlassian.net", "name": "a", "scopes": ["read:page:confluence"] },
        { "cloudId": "b", "url": "https://b.atlassian.net" },
    ]});
    let found = sites(&v);
    assert_eq!(found.len(), 2);
    assert_eq!(found[1].name, "b.atlassian.net", "no name: its host");
    assert_eq!(found[0].host(), "a.atlassian.net");
    assert_eq!(
        choose(found.clone(), Some("b")).map(|s| s.id),
        Ok("b".into())
    );
    assert!(
        choose(found, Some("gone")).is_err(),
        "a stale saved site asks again"
    );
}

#[test]
fn boards_take_numeric_or_string_ids() {
    let v = json!([{ "boardId": "3", "name": "Ops", "boardType": "KANBAN" }, { "name": "no id" }]);
    let b = boards(&v).expect("boards");
    assert_eq!(b.len(), 1);
    assert_eq!(
        (b[0].id.as_str(), b[0].board_type.as_str()),
        ("3", "kanban")
    );
}

#[test]
fn status_categories_normalise_from_keys_and_names() {
    let v = json!({ "values": [
        { "id": "1", "name": "Open", "statusCategory": "TODO" },
        { "id": "2", "name": "Shipped", "statusCategory": { "key": "done" } },
        { "id": 3, "name": "Review", "statusCategory": { "name": "In Progress" } },
        { "id": 4, "name": "No category" },
    ]});
    let meta = statuses(&v);
    assert!(
        !meta.contains_key("4"),
        "left to the board to place, not guessed"
    );
    assert_eq!(meta["1"].1, "new");
    assert_eq!(meta["2"].1, "done");
    assert_eq!(
        meta["3"],
        ("Review".to_string(), "indeterminate".to_string())
    );
}

#[test]
fn transitions_take_a_flat_target_too() {
    let v = json!([{ "id": 5, "toStatusId": 10 }]);
    let t = transitions(&v);
    assert_eq!((t[0].id.as_str(), t[0].to_id.as_deref()), ("5", Some("10")));
}

#[test]
fn the_rest_user_shape_still_reads() {
    let v = json!({ "accountId": "x", "displayName": "Ada", "emailAddress": "a@b" });
    let u = user(&v).expect("user");
    assert_eq!(
        (u.account_id.as_str(), u.email.as_deref()),
        ("x", Some("a@b"))
    );
}

#[test]
fn a_last_page_has_no_next_token_whatever_it_says() {
    let (_, next) =
        issue_page(&json!({ "issues": [], "isLast": true, "nextPageToken": "x" })).expect("page");
    assert_eq!(next, None);
    let (_, next) = issue_page(&json!({ "issues": [], "nextPageToken": "y" })).expect("page");
    assert_eq!(next.as_deref(), Some("y"));
}

#[test]
fn the_active_sprint_is_found_among_others() {
    let v = json!({ "values": [{ "name": "Old", "state": "closed" }, { "name": "Now", "state": "active" }] });
    assert_eq!(active_sprint(&v).as_deref(), Some("Now"));
    assert_eq!(active_sprint(&json!({ "values": [] })), None);
}
