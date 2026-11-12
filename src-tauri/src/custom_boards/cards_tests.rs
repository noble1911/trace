use super::*;
use crate::custom_boards::edit::create_board;

fn two_boards() -> BoardsFile {
    let mut file = BoardsFile::default();
    create_board(&mut file, "a".into(), "Alpha").expect("a");
    create_board(&mut file, "b".into(), "Beta").expect("b");
    file
}

fn new_card(summary: &str) -> NewCard {
    NewCard {
        summary: summary.into(),
        ..NewCard::default()
    }
}

/// A card as the next number after the file's (what `counter` hands out on a
/// fresh machine).
fn add(file: &mut BoardsFile, board: &str, summary: &str) -> Card {
    let number = file.last_number + 1;
    create_card(
        file,
        board,
        new_card(summary),
        number,
        "2026-11-12T00:00:00Z".into(),
    )
    .expect("card")
}

fn card<'a>(file: &'a BoardsFile, key: &str) -> &'a Card {
    file.find_card(key).expect("card").1
}

#[test]
fn a_card_takes_the_number_its_given_and_the_file_keeps_up() {
    let mut file = two_boards();
    assert_eq!(add(&mut file, "a", "one").key, "local-1");
    let c = create_card(&mut file, "b", new_card("two"), 7, "t".into()).expect("card");
    assert_eq!(c.key, "local-7");
    assert_eq!(file.last_number, 7, "kept for an older trace");
    let c = create_card(&mut file, "b", new_card("three"), 4, "t".into()).expect("card");
    assert_eq!((c.key.as_str(), file.last_number), ("local-4", 7));
    let again = create_card(&mut file, "a", new_card("dup"), 7, "t".into());
    assert!(
        again.is_err(),
        "a key already on a board is never given twice"
    );
}

#[test]
fn a_new_card_takes_the_defaults() {
    let mut file = two_boards();
    let c = add(&mut file, "a", "  Fix it  ");
    assert_eq!(c.summary, "Fix it");
    assert_eq!(c.column, "todo");
    assert_eq!(c.priority, "p2");
    assert!(c.description.is_none() && c.labels.is_empty() && c.comments.is_empty());
}

#[test]
fn a_new_card_takes_what_its_given() {
    let mut file = two_boards();
    let given = NewCard {
        summary: "Ship".into(),
        description: Some("Details".into()),
        column_id: Some("in-progress".into()),
        priority: Some("p0".into()),
        labels: Some(vec![" ui ".into(), "".into(), "ui".into(), "be".into()]),
        type_id: None,
    };
    let c = create_card(&mut file, "a", given, 1, "t".into()).expect("card");
    assert_eq!(c.column, "in-progress");
    assert_eq!(c.priority, "p0");
    assert_eq!(c.description.as_deref(), Some("Details"));
    assert_eq!(c.labels, ["ui", "be"]);
}

#[test]
fn bad_cards_are_refused_and_use_no_number() {
    let mut file = two_boards();
    assert!(create_card(&mut file, "a", new_card(" "), 1, "t".into()).is_err());
    assert!(create_card(&mut file, "zz", new_card("x"), 1, "t".into()).is_err());
    let bad_priority = NewCard {
        priority: Some("high".into()),
        ..new_card("x")
    };
    assert!(create_card(&mut file, "a", bad_priority, 1, "t".into()).is_err());
    let bad_column = NewCard {
        column_id: Some("gone".into()),
        ..new_card("x")
    };
    assert!(create_card(&mut file, "a", bad_column, 1, "t".into()).is_err());
    assert_eq!(file.last_number, 0);
    assert!(file.boards.iter().all(|b| b.cards.is_empty()));
}

#[test]
fn updates_change_only_whats_given() {
    let mut file = two_boards();
    let key = add(&mut file, "a", "One").key;
    let patch = CardPatch {
        description: Some("Why".into()),
        labels: Some(vec!["x".into()]),
        ..CardPatch::default()
    };
    update_card(&mut file, &key, patch).expect("update");
    let c = card(&file, &key);
    assert_eq!((c.summary.as_str(), c.priority.as_str()), ("One", "p2"));
    assert_eq!(c.description.as_deref(), Some("Why"));

    let clear = CardPatch {
        summary: Some("Renamed".into()),
        description: Some(" ".into()),
        priority: Some("p1".into()),
        ..CardPatch::default()
    };
    let c = update_card(&mut file, &key, clear).expect("update");
    assert_eq!((c.summary.as_str(), c.priority.as_str()), ("Renamed", "p1"));
    assert!(c.description.is_none());
    assert_eq!(c.labels, ["x"]);

    let empty = CardPatch {
        summary: Some("".into()),
        ..CardPatch::default()
    };
    assert!(update_card(&mut file, &key, empty).is_err());
    assert!(update_card(&mut file, "local-99", CardPatch::default()).is_err());
}

#[test]
fn a_card_with_a_running_agent_stays() {
    let mut file = two_boards();
    let key = add(&mut file, "a", "One").key;
    let other = add(&mut file, "a", "Two").key;
    let refused = delete_card(&mut file, &key, |k| k == key).expect_err("running");
    assert!(refused.contains("running"), "{refused}");
    // Another card's agent running doesn't hold this one.
    delete_card(&mut file, &key, |k| k == other).expect("delete");
    assert!(file.find_card(&key).is_none());
    assert!(delete_card(&mut file, &key, |_| false).is_err());
}

#[test]
fn transitions_move_to_the_first_matching_column_at_its_end() {
    let mut file = two_boards();
    let one = add(&mut file, "a", "One").key;
    let two = add(&mut file, "a", "Two").key;
    let targets = vec!["nope".to_string(), "done".to_string(), "todo".to_string()];
    transition(&mut file, &one, &targets).expect("move");
    assert_eq!(card(&file, &one).column, "done");
    let order: Vec<_> = file.boards[0]
        .cards
        .iter()
        .map(|c| c.key.as_str())
        .collect();
    assert_eq!(order, [two.as_str(), one.as_str()]);
    // Already there: nothing changes.
    let before = file.clone();
    transition(&mut file, &one, &["done".to_string()]).expect("stay");
    assert_eq!(file, before);
    // Only the card's own board's columns count.
    assert!(transition(&mut file, &one, &["gone".to_string()]).is_err());
    assert!(transition(&mut file, "local-99", &["done".to_string()]).is_err());
}

#[test]
fn comments_are_kept_with_the_card() {
    let mut file = two_boards();
    let key = add(&mut file, "b", "One").key;
    add_comment(&mut file, &key, "You", "t1".into(), "  First  ").expect("comment");
    add_comment(&mut file, &key, "You", "t2".into(), "Second").expect("comment");
    assert!(add_comment(&mut file, &key, "You", "t3".into(), "  ").is_err());
    assert!(add_comment(&mut file, "local-99", "You", "t".into(), "x").is_err());
    let bodies: Vec<_> = card(&file, &key)
        .comments
        .iter()
        .map(|c| c.body.as_str())
        .collect();
    assert_eq!(bodies, ["First", "Second"]);
}
