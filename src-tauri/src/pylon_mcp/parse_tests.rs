//! The tolerant readers: REST's shapes and the variations beside them.
use super::*;
use serde_json::json;

#[test]
fn a_list_is_found_bare_named_or_under_data() {
    let keys = &["issues"];
    assert_eq!(list(&json!([1, 2]), keys).len(), 2);
    assert_eq!(list(&json!({ "issues": [1] }), keys).len(), 1);
    assert_eq!(list(&json!({ "data": [1, 2, 3] }), keys).len(), 3);
    assert_eq!(list(&json!({ "data": { "issues": [1] } }), keys).len(), 1);
    assert!(list(&json!({ "other": [1] }), keys).is_empty());
}

#[test]
fn a_cursor_counts_only_while_there_are_more_pages() {
    let rest = json!({ "pagination": { "cursor": "c2", "has_next_page": true } });
    assert_eq!(next_cursor(&rest).as_deref(), Some("c2"));
    let done = json!({ "pagination": { "cursor": "c2", "has_next_page": false } });
    assert_eq!(next_cursor(&done), None);
    let flat = json!({ "next_cursor": "c3" });
    assert_eq!(next_cursor(&flat).as_deref(), Some("c3"), "no flag: more");
    assert_eq!(next_cursor(&json!({ "cursor": "" })), None);
    assert_eq!(next_cursor(&json!({ "data": [] })), None);
}

#[test]
fn an_issue_is_normalised_to_rests_shape() {
    let v = json!({ "id": 55, "number": "#12", "status": { "slug": "on_hold" },
                    "body": "<p>Hi</p>", "title": "T" });
    let card = issue(&v, &UserNames::new()).expect("card");
    assert_eq!((card.id.as_str(), card.key.as_str()), ("55", "#12"));
    assert_eq!(
        (card.status_id.as_str(), card.status_category.as_str()),
        ("on_hold", "indeterminate")
    );
    assert_eq!(card.description.as_deref(), Some("Hi"));
    assert_eq!(card.priority, "p3");
    assert_eq!(card.issue_type, "Support");
    let numbered_only = json!({ "number": 8, "state": "new" });
    assert_eq!(
        issue(&numbered_only, &UserNames::new()).expect("card").id,
        "8"
    );
}

#[test]
fn me_reads_the_user_or_rests_org_centric_shape() {
    let flat = me(&json!({ "id": "u1", "name": "Sam", "email": "sam@example.com" })).expect("me");
    assert_eq!(
        (flat.account_id.as_str(), flat.display_name.as_str()),
        ("u1", "Sam")
    );
    let rest = me(
        &json!({ "data": { "name": "Org", "user": { "id": "u2", "email": "kim@example.com" } } }),
    )
    .expect("me");
    assert_eq!(
        (rest.account_id.as_str(), rest.display_name.as_str()),
        ("u2", "kim")
    );
}

#[test]
fn a_login_with_no_id_doesnt_validate() {
    let err = me(&json!({ "data": { "name": "Org" } }))
        .err()
        .expect("refused");
    assert_eq!(
        err,
        "Pylon's MCP server didn't say who trace is signed in as."
    );
}

#[test]
fn text_in_place_of_json_is_an_error_quoting_it() {
    let err = readable("search_issues", json!("Rate limited, try later")).expect_err("refused");
    assert_eq!(
        err,
        "Pylon's MCP server answered search_issues with something trace couldn't read: \
         Rate limited, try later"
    );
    assert!(readable("search_issues", json!({ "data": [] })).is_ok());
    assert!(listed(&json!({ "other": [] }), &["issues"], "issues").is_err());
}

#[test]
fn archived_statuses_are_left_out() {
    let v = json!({ "statuses": [
        { "slug": "triage", "label": "Triage", "is_archived": false },
        { "slug": "gone", "label": "Gone", "is_archived": true },
        { "label": "No slug" }
    ] });
    assert_eq!(
        statuses(&v),
        [Status {
            slug: "triage".into(),
            label: Some("Triage".into())
        }]
    );
}

#[test]
fn users_are_named_by_id() {
    let v = json!({ "users": [{ "id": "u1", "name": "Jo" }, { "id": "u2", "email": "x@y" }] });
    let names = users(&v);
    assert_eq!(names.get("u1").map(|(n, _)| n.as_str()), Some("Jo"));
    assert!(
        !names.contains_key("u2"),
        "no name: left to the email fallback"
    );
}
