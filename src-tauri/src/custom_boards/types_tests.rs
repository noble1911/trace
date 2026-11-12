use super::*;
use crate::custom_boards::cards::{create_card, update_card, CardPatch, NewCard};
use crate::custom_boards::edit::create_board;
use crate::custom_boards::template::{self, BoardTemplate};
use crate::custom_boards::view;

/// A board "b" with types Feature (f) and Bug (g, with a brief).
fn typed_board() -> BoardsFile {
    let mut file = BoardsFile::default();
    create_board(&mut file, "b".into(), "Work").expect("board");
    add_type(&mut file, "b", "f".into(), "Feature", None).expect("feature");
    add_type(&mut file, "b", "g".into(), " Bug ", Some(" Fix it ".into())).expect("bug");
    file
}

fn new_card(type_id: Option<&str>) -> NewCard {
    NewCard {
        summary: "Card".into(),
        type_id: type_id.map(str::to_string),
        ..NewCard::default()
    }
}

fn add_card(file: &mut BoardsFile, type_id: Option<&str>) -> String {
    let number = file.last_number + 1;
    create_card(file, "b", new_card(type_id), number, "t".into())
        .expect("card")
        .key
}

fn issue_type(file: &BoardsFile, key: &str) -> String {
    let (board, card) = file.find_card(key).expect("card");
    view::issue(board, card).issue_type
}

#[test]
fn types_are_added_trimmed_with_their_briefs() {
    let file = typed_board();
    let types = &file.boards[0].card_types;
    assert_eq!(types.len(), 2);
    assert_eq!(
        (types[1].name.as_str(), types[1].prompt.as_deref()),
        ("Bug", Some("Fix it"))
    );
    assert!(types[0].prompt.is_none());
}

#[test]
fn names_are_unique_any_case_never_empty_never_task() {
    let mut file = typed_board();
    assert!(add_type(&mut file, "b", "x".into(), "feature", None).is_err());
    assert!(add_type(&mut file, "b", "x".into(), "  ", None).is_err());
    assert!(add_type(&mut file, "b", "x".into(), "TASK", None).is_err());
    assert!(add_type(&mut file, "b", "f".into(), "Spike", None).is_err());
    assert!(add_type(&mut file, "nope", "x".into(), "Spike", None).is_err());
    // A type may keep its own name in another case.
    update_type(&mut file, "b", "f", Some("FEATURE"), None).expect("recase");
    assert!(update_type(&mut file, "b", "f", Some("bug"), None).is_err());
    assert!(update_type(&mut file, "b", "f", Some("task"), None).is_err());
    assert!(update_type(&mut file, "b", "zz", Some("Spike"), None).is_err());
}

#[test]
fn update_renames_sets_and_clears_the_brief() {
    let mut file = typed_board();
    update_type(&mut file, "b", "f", None, Some("Plan first".into())).expect("set");
    assert_eq!(
        file.boards[0].card_types[0].prompt.as_deref(),
        Some("Plan first")
    );
    update_type(&mut file, "b", "f", Some("Story"), None).expect("rename");
    let t = &file.boards[0].card_types[0];
    assert_eq!(
        (t.name.as_str(), t.prompt.as_deref()),
        ("Story", Some("Plan first"))
    );
    update_type(&mut file, "b", "f", None, Some("  ".into())).expect("clear");
    assert!(file.boards[0].card_types[0].prompt.is_none());
}

#[test]
fn the_issue_type_is_the_type_name_or_task() {
    let mut file = typed_board();
    let first = add_card(&mut file, None);
    let bug = add_card(&mut file, Some("g"));
    let untyped = add_card(&mut file, Some(""));
    assert_eq!(issue_type(&file, &first), "Feature");
    assert_eq!(issue_type(&file, &bug), "Bug");
    assert_eq!(issue_type(&file, &untyped), "Task");
    // Renaming a type renames its cards' type.
    update_type(&mut file, "b", "g", Some("Defect"), None).expect("rename");
    assert_eq!(issue_type(&file, &bug), "Defect");
    // A board without types: every card is a Task.
    create_board(&mut file, "plain".into(), "Plain").expect("board");
    let number = file.last_number + 1;
    let c = create_card(&mut file, "plain", new_card(None), number, "t".into()).expect("card");
    assert!(c.type_id.is_none());
    assert_eq!(issue_type(&file, &c.key), "Task");
    // A type id from elsewhere is refused.
    assert!(create_card(&mut file, "b", new_card(Some("zz")), 99, "t".into()).is_err());
}

#[test]
fn a_card_update_sets_keeps_or_clears_its_type() {
    let mut file = typed_board();
    let key = add_card(&mut file, None);
    let set = |type_id: &str| CardPatch {
        type_id: Some(type_id.to_string()),
        ..CardPatch::default()
    };
    update_card(&mut file, &key, set("g")).expect("set");
    assert_eq!(issue_type(&file, &key), "Bug");
    update_card(&mut file, &key, CardPatch::default()).expect("keep");
    assert_eq!(issue_type(&file, &key), "Bug");
    update_card(&mut file, &key, set("")).expect("clear");
    assert!(file.find_card(&key).expect("card").1.type_id.is_none());
    assert!(update_card(&mut file, &key, set("zz")).is_err());
}

#[test]
fn deleting_a_type_moves_or_unsets_its_cards() {
    let mut file = typed_board();
    let feature = add_card(&mut file, Some("f"));
    let bug = add_card(&mut file, Some("g"));
    // With cards and no target: refused, nothing changes.
    assert!(delete_type(&mut file, "b", "f", None).is_err());
    assert!(delete_type(&mut file, "b", "f", Some("f")).is_err());
    assert!(delete_type(&mut file, "b", "f", Some("zz")).is_err());
    assert_eq!(file.boards[0].card_types.len(), 2);

    delete_type(&mut file, "b", "f", Some("g")).expect("move to bug");
    assert_eq!(issue_type(&file, &feature), "Bug");
    delete_type(&mut file, "b", "g", Some(NO_TYPE)).expect("leave untyped");
    assert_eq!(issue_type(&file, &feature), "Task");
    assert_eq!(issue_type(&file, &bug), "Task");
    assert!(file.boards[0].card_types.is_empty());
}

#[test]
fn a_type_without_cards_deletes_without_a_target() {
    let mut file = typed_board();
    add_card(&mut file, Some("g"));
    delete_type(&mut file, "b", "f", None).expect("delete");
    assert_eq!(file.boards[0].card_types.len(), 1);
}

#[test]
fn a_template_gives_columns_and_types() {
    let raw = serde_json::json!({
        "columns": [
            { "name": "Inbox", "category": "new" },
            { "name": "Doing", "category": "indeterminate" },
            { "name": "Shipped", "category": "done" }
        ],
        "cardTypes": [{ "name": "Feature" }, { "name": "Bug", "prompt": "Reproduce first." }]
    });
    let t: BoardTemplate = serde_json::from_value(raw).expect("template");
    let mut file = BoardsFile::default();
    let board = template::create_board(&mut file, "b".into(), "Product", t).expect("board");
    let names: Vec<_> = board.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Inbox", "Doing", "Shipped"]);
    assert!(board.columns.iter().all(|c| c.id.len() == 8));
    assert_eq!(board.card_types.len(), 2);
    assert_eq!(
        board.card_types[1].prompt.as_deref(),
        Some("Reproduce first.")
    );
    assert_ne!(board.card_types[0].id, board.card_types[1].id);
    assert!(
        template::create_board(&mut file, "b".into(), "Again", BoardTemplate::default()).is_err()
    );
}

#[test]
fn bad_templates_are_refused() {
    let column = |category: &str| template::TemplateColumn {
        name: "Col".into(),
        category: category.into(),
    };
    let card_type = |name: &str| template::TemplateType {
        name: name.into(),
        prompt: None,
    };
    let make = |columns, card_types| {
        template::board_from(
            "b".into(),
            "B",
            BoardTemplate {
                columns,
                card_types,
            },
        )
    };
    assert!(make(vec![], vec![]).is_err());
    assert!(make(vec![column("todo")], vec![]).is_err());
    assert!(make(vec![column("new")], vec![card_type("A"), card_type("a")]).is_err());
    assert!(make(vec![column("new")], vec![card_type("Task")]).is_err());
    assert!(make(vec![column("new")], vec![]).is_ok());
}

#[test]
fn an_old_file_without_types_loads() {
    let raw = serde_json::json!({
        "boards": [{
            "id": "b", "name": "Old",
            "columns": [{ "id": "todo", "name": "To do", "category": "new" }],
            "cards": [{
                "key": "local-1", "summary": "S", "priority": "p2",
                "column": "todo", "created": "t"
            }]
        }],
        "lastNumber": 1
    });
    let file: BoardsFile = serde_json::from_value(raw).expect("old file");
    assert!(file.boards[0].card_types.is_empty());
    assert_eq!(issue_type(&file, "local-1"), "Task");
    // An untyped card writes no `typeId`.
    let out = serde_json::to_string(&file).expect("json");
    assert!(!out.contains("typeId"));
    assert!(out.contains("\"cardTypes\":[]"));
}

#[test]
fn the_config_is_id_name_and_types() {
    let file = typed_board();
    let config = serde_json::to_value(view::config(&file.boards[0])).expect("json");
    assert_eq!(config["id"], "b");
    assert_eq!(config["name"], "Work");
    assert_eq!(config["cardTypes"][0]["name"], "Feature");
    assert!(config["cardTypes"][0]["prompt"].is_null());
    assert_eq!(config["cardTypes"][1]["prompt"], "Fix it");
}
