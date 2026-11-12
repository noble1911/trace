use super::*;
use crate::custom_boards::cards::{create_card, NewCard};

fn file_with_board() -> BoardsFile {
    let mut file = BoardsFile::default();
    create_board(&mut file, "b1".into(), "Side projects").expect("create");
    file
}

fn card_in(file: &mut BoardsFile, column: &str) -> String {
    let card = NewCard {
        summary: "Do it".into(),
        column_id: Some(column.into()),
        ..NewCard::default()
    };
    let number = file.last_number + 1;
    create_card(file, "b1", card, number, "t".into())
        .expect("card")
        .key
}

fn column_ids(file: &BoardsFile) -> Vec<&str> {
    file.boards[0]
        .columns
        .iter()
        .map(|c| c.id.as_str())
        .collect()
}

#[test]
fn a_new_board_starts_with_to_do_in_progress_done() {
    let file = file_with_board();
    let board = &file.boards[0];
    let names: Vec<_> = board.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["To do", "In progress", "Done"]);
    let cats: Vec<_> = board.columns.iter().map(|c| c.category).collect();
    assert_eq!(
        cats,
        [Category::New, Category::Indeterminate, Category::Done]
    );
}

#[test]
fn names_are_trimmed_and_never_empty() {
    let mut file = file_with_board();
    assert!(create_board(&mut file, "b2".into(), "   ").is_err());
    assert!(create_board(&mut file, "b1".into(), "Dup id").is_err());
    rename_board(&mut file, "b1", "  Two\nlines  ").expect("rename");
    assert_eq!(file.boards[0].name, "Two lines");
    assert!(rename_board(&mut file, "b1", "").is_err());
    assert!(rename_board(&mut file, "nope", "X").is_err());
    assert!(add_column(&mut file, "b1", "c".into(), " ", Category::New).is_err());
    assert!(update_column(&mut file, "b1", "todo", Some(""), None).is_err());
}

#[test]
fn columns_add_update_and_move() {
    let mut file = file_with_board();
    add_column(
        &mut file,
        "b1",
        "rev".into(),
        "Review",
        Category::Indeterminate,
    )
    .expect("add");
    assert_eq!(column_ids(&file), ["todo", "in-progress", "done", "rev"]);
    assert!(add_column(&mut file, "b1", "rev".into(), "Again", Category::New).is_err());

    update_column(
        &mut file,
        "b1",
        "rev",
        Some("In review"),
        Some(Category::Done),
    )
    .expect("update");
    let rev = file.boards[0].column("rev").expect("rev");
    assert_eq!(
        (rev.name.as_str(), rev.category),
        ("In review", Category::Done)
    );
    update_column(&mut file, "b1", "rev", None, None).expect("no-op update");

    move_column(&mut file, "b1", "rev", 2).expect("move");
    assert_eq!(column_ids(&file), ["todo", "in-progress", "rev", "done"]);
    move_column(&mut file, "b1", "todo", 99).expect("move past the end");
    assert_eq!(column_ids(&file), ["in-progress", "rev", "done", "todo"]);
    move_column(&mut file, "b1", "todo", 0).expect("move first");
    assert_eq!(column_ids(&file), ["todo", "in-progress", "rev", "done"]);
    assert!(move_column(&mut file, "b1", "gone", 0).is_err());
}

#[test]
fn an_empty_column_deletes() {
    let mut file = file_with_board();
    delete_column(&mut file, "b1", "in-progress", None).expect("delete");
    assert_eq!(column_ids(&file), ["todo", "done"]);
}

#[test]
fn a_column_with_cards_needs_somewhere_to_send_them() {
    let mut file = file_with_board();
    let a = card_in(&mut file, "todo");
    let b = card_in(&mut file, "done");
    let c = card_in(&mut file, "todo");
    let refused = delete_column(&mut file, "b1", "todo", None).expect_err("has cards");
    assert!(refused.contains("has cards"), "{refused}");
    assert!(delete_column(&mut file, "b1", "todo", Some("todo")).is_err());
    assert!(delete_column(&mut file, "b1", "todo", Some("gone")).is_err());
    assert_eq!(column_ids(&file), ["todo", "in-progress", "done"]);

    delete_column(&mut file, "b1", "todo", Some("done")).expect("move then delete");
    assert_eq!(column_ids(&file), ["in-progress", "done"]);
    let order: Vec<_> = file.boards[0]
        .cards
        .iter()
        .map(|c| (c.key.clone(), c.column.clone()))
        .collect();
    let done = "done".to_string();
    assert_eq!(order, [(b, done.clone()), (a, done.clone()), (c, done)]);
}

#[test]
fn the_last_column_stays() {
    let mut file = file_with_board();
    delete_column(&mut file, "b1", "todo", None).expect("first");
    delete_column(&mut file, "b1", "in-progress", None).expect("second");
    let refused = delete_column(&mut file, "b1", "done", None).expect_err("last");
    assert!(refused.contains("at least one column"), "{refused}");
}

#[test]
fn a_board_with_a_running_agent_stays() {
    let mut file = file_with_board();
    let key = card_in(&mut file, "todo");
    let refused = delete_board(&mut file, "b1", |k| k == key).expect_err("running");
    assert!(refused.contains(&key), "{refused}");
    assert_eq!(file.boards.len(), 1);
    let gone = delete_board(&mut file, "b1", |_| false).expect("delete");
    assert_eq!(gone.cards.len(), 1);
    assert!(file.boards.is_empty());
    assert!(delete_board(&mut file, "b1", |_| false).is_err());
}

#[test]
fn deleting_a_board_never_frees_its_keys() {
    let mut file = file_with_board();
    card_in(&mut file, "todo");
    card_in(&mut file, "todo");
    delete_board(&mut file, "b1", |_| false).expect("delete");
    create_board(&mut file, "b1".into(), "Again").expect("create");
    assert_eq!(card_in(&mut file, "todo"), "local-3");
}
