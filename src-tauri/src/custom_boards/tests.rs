//! The adapter end to end, on a file in a temp dir: the commands' operations and
//! the `IssueProvider` impl, mapped to the shapes every board takes.

use super::cards::{CardPatch, NewCard};
use super::*;
use tauri::async_runtime::block_on;

fn boards() -> (tempfile::TempDir, CustomBoards) {
    let dir = tempfile::tempdir().expect("tempdir");
    let boards = CustomBoards::at(dir.path().join("custom-boards.json"));
    (dir, boards)
}

fn card(summary: &str) -> NewCard {
    NewCard {
        summary: summary.into(),
        ..NewCard::default()
    }
}

#[test]
fn boards_list_as_custom() {
    let (_dir, boards) = boards();
    assert!(block_on(boards.list_boards()).expect("list").is_empty());
    let made = boards.create_board("Side projects", None).expect("create");
    assert_eq!(made.board_type, "custom");
    assert_eq!(made.id.len(), 8);
    let listed = block_on(boards.list_boards()).expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0].id.as_str(), listed[0].name.as_str()),
        (made.id.as_str(), "Side projects")
    );
    boards.rename_board(&made.id, "Renamed").expect("rename");
    let data = block_on(boards.get_board(&made.id)).expect("board");
    assert_eq!(data.board_name, "Renamed");
    assert!(data.sprint_name.is_none());
    assert!(block_on(boards.get_board("nope")).is_err());
}

#[test]
fn a_board_maps_each_column_to_one_status() {
    let (_dir, boards) = boards();
    let id = boards.create_board("B", None).expect("create").id;
    let data = boards
        .add_column(&id, "Review", "indeterminate")
        .expect("add");
    assert_eq!(data.columns.len(), 4);
    for column in &data.columns {
        assert_eq!(column.statuses.len(), 1);
        assert_eq!(column.statuses[0].name, column.name);
    }
    let review = &data.columns[3].statuses[0];
    assert_eq!(review.category, "indeterminate");
    assert!(boards.add_column(&id, "X", "later").is_err());

    let data = boards
        .update_column(&id, &review.id, Some("QA"), Some("done"))
        .expect("update");
    assert_eq!(data.columns[3].name, "QA");
    assert_eq!(data.columns[3].statuses[0].category, "done");
    let data = boards.move_column(&id, &review.id, 0).expect("move");
    assert_eq!(data.columns[0].name, "QA");
    let data = boards.delete_column(&id, &review.id, None).expect("delete");
    assert_eq!(data.columns.len(), 3);
}

#[test]
fn a_card_is_an_issue() {
    let (_dir, boards) = boards();
    let id = boards.create_board("B", None).expect("create").id;
    let issue = boards.create_card(&id, card("Fix it")).expect("card");
    assert_eq!(
        (issue.id.as_str(), issue.key.as_str()),
        ("local-1", "local-1")
    );
    assert_eq!(issue.issue_type, "Task");
    assert_eq!(issue.priority, "p2");
    assert_eq!(
        (issue.status_id.as_str(), issue.status_name.as_str()),
        ("todo", "To do")
    );
    assert_eq!(issue.status_category, "new");
    assert!(issue.browse_url.is_none());
    let me = issue.assignee.as_ref().expect("assignee");
    let user = block_on(boards.current_user()).expect("user");
    assert_eq!(me.account_id, user.account_id);

    let patch = CardPatch {
        priority: Some("p1".into()),
        ..CardPatch::default()
    };
    let issue = boards.update_card("local-1", patch).expect("update");
    assert_eq!(issue.priority, "p1");
    let data = block_on(boards.get_board(&id)).expect("board");
    assert_eq!(data.issues.len(), 1);
    assert_eq!(data.issues[0].priority, "p1");
}

#[test]
fn moving_commenting_and_status_go_through_the_provider() {
    let (_dir, boards) = boards();
    let id = boards.create_board("B", None).expect("create").id;
    boards.create_card(&id, card("One")).expect("card");
    let status = |k: &str| block_on(boards.status_category(k));
    assert_eq!(status("local-1").as_deref(), Ok("new"));

    block_on(boards.transition_issue("local-1", &["in-progress".into()])).expect("move");
    assert_eq!(status("local-1").as_deref(), Ok("indeterminate"));
    block_on(boards.transition_issue("local-1", &["done".into()])).expect("move");
    assert_eq!(status("local-1").as_deref(), Ok("done"));
    assert!(status("local-9").is_err());

    block_on(boards.add_comment("local-1", "Looks good")).expect("comment");
    let comments = block_on(boards.list_comments("local-1")).expect("comments");
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].body, "Looks good");
    assert_eq!(comments[0].author, "You");
    assert!(!comments[0].is_internal);
    assert!(comments[0]
        .created
        .as_deref()
        .is_some_and(|c| c.ends_with('Z')));
    assert!(block_on(boards.list_comments("local-9"))
        .expect("none")
        .is_empty());
    assert!(block_on(boards.get_pull_requests("local-1", true))
        .expect("prs")
        .is_empty());
}

#[test]
fn refusals_reach_the_caller_and_change_nothing() {
    let (_dir, boards) = boards();
    let id = boards.create_board("B", None).expect("create").id;
    boards.create_card(&id, card("One")).expect("card");
    assert!(boards.create_board(" ", None).is_err());
    assert!(boards.delete_column(&id, "todo", None).is_err());
    assert!(boards.delete_card("local-1", |k| k == "local-1").is_err());
    assert!(boards.delete_board(&id, |k| k == "local-1").is_err());
    assert_eq!(
        block_on(boards.get_board(&id)).expect("board").issues.len(),
        1
    );
    boards
        .delete_card("local-1", |_| false)
        .expect("delete card");
    boards.delete_board(&id, |_| false).expect("delete board");
    assert!(block_on(boards.list_boards()).expect("list").is_empty());
}

#[test]
fn it_says_it_is_local() {
    let (_dir, boards) = boards();
    let session = serde_json::to_value(boards.session_info()).expect("json");
    assert_eq!(session["provider"], "custom");
    assert_eq!(session["via"], "local");
}

#[test]
fn custom_keys_route_to_custom_boards() {
    use crate::issues::ProviderKind;
    assert!(ProviderKind::for_issue_key("local-12") == ProviderKind::Custom);
    assert!(ProviderKind::for_issue_key("TRACE-12") == ProviderKind::Jira);
    assert!(ProviderKind::for_issue_key("#12") == ProviderKind::Pylon);
    assert!(ProviderKind::parse("custom") == Ok(ProviderKind::Custom));
    assert_eq!(crate::helpers::slugify("local-12"), "local-12");
}

#[test]
fn card_types_end_to_end() {
    let (_dir, boards) = boards();
    let template: template::BoardTemplate = serde_json::from_value(serde_json::json!({
        "columns": [{ "name": "Open", "category": "new" }],
        "cardTypes": [{ "name": "Feature" }]
    }))
    .expect("template");
    let id = boards.create_board("T", Some(template)).expect("create").id;
    let config = boards.add_card_type(&id, "Bug", None).expect("add");
    assert_eq!(config.card_types.len(), 2);
    let (feature, bug) = (
        config.card_types[0].id.clone(),
        config.card_types[1].id.clone(),
    );

    let issue = boards.create_card(&id, card("One")).expect("card");
    assert_eq!(issue.issue_type, "Feature");
    let patch = CardPatch {
        type_id: Some(bug.clone()),
        ..CardPatch::default()
    };
    assert_eq!(
        boards
            .update_card("local-1", patch)
            .expect("update")
            .issue_type,
        "Bug"
    );

    let config = boards
        .update_card_type(&id, &bug, Some("Defect"), Some("Repro".into()))
        .expect("update type");
    assert_eq!(config.card_types[1].prompt.as_deref(), Some("Repro"));
    let data = block_on(boards.get_board(&id)).expect("board");
    assert_eq!(data.issues[0].issue_type, "Defect");

    assert!(boards.delete_card_type(&id, &bug, None).is_err());
    let config = boards
        .delete_card_type(&id, &bug, Some(""))
        .expect("delete");
    assert_eq!(config.card_types.len(), 1);
    assert_eq!(config.card_types[0].id, feature);
    let data = block_on(boards.get_board(&id)).expect("board");
    assert_eq!(data.issues[0].issue_type, "Task");
    assert_eq!(boards.config(&id).expect("config").name, "T");
    assert!(boards.config("nope").is_err());
}
