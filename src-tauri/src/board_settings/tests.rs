use super::*;

fn configured() -> Vec<String> {
    vec!["/a".into(), "/b".into()]
}

fn settings(prompt: Option<&str>, repos: &[&str], default_repo: Option<&str>) -> BoardSettings {
    BoardSettings {
        kickoff_prompt: prompt.map(str::to_string),
        repos: repos.iter().map(|r| r.to_string()).collect(),
        default_repo: default_repo.map(str::to_string),
    }
}

#[test]
fn board_keys_name_a_provider_and_a_board() {
    assert!(check_key("jira:12").is_ok());
    assert!(check_key("pylon:open-issues").is_ok());
    assert!(check_key("custom:ab12cd34").is_ok());
    assert!(check_key("github:1").is_err());
    assert!(check_key("jira:").is_err());
    assert!(check_key("jira: ").is_err());
    assert!(check_key("12").is_err());
}

#[test]
fn prompts_are_trimmed_empty_is_none_and_capped() {
    let saved = validate(settings(Some("  Do it.  "), &[], None), &configured()).expect("ok");
    assert_eq!(saved.kickoff_prompt.as_deref(), Some("Do it."));
    let blank = validate(settings(Some("  \n "), &[], None), &configured()).expect("ok");
    assert!(blank.kickoff_prompt.is_none());
    let long = "x".repeat(MAX_PROMPT_CHARS + 1);
    assert!(validate(settings(Some(&long), &[], None), &configured()).is_err());
    let at_cap = "x".repeat(MAX_PROMPT_CHARS);
    assert!(validate(settings(Some(&at_cap), &[], None), &configured()).is_ok());
}

#[test]
fn repos_must_be_configured_and_are_kept_once() {
    assert!(validate(settings(None, &["/nope"], None), &configured()).is_err());
    let saved = validate(settings(None, &["/b", "/a", "/b"], None), &configured()).expect("ok");
    assert_eq!(saved.repos, ["/b", "/a"]);
}

#[test]
fn the_default_must_be_one_of_the_boards_repos() {
    assert!(validate(settings(None, &["/a"], Some("/b")), &configured()).is_err());
    assert!(validate(settings(None, &[], Some("/a")), &configured()).is_err());
    let ok = validate(settings(None, &["/a", "/b"], Some("/b")), &configured()).expect("ok");
    assert_eq!(ok.default_repo.as_deref(), Some("/b"));
    let empty = validate(settings(None, &["/a"], Some("")), &configured()).expect("ok");
    assert!(empty.default_repo.is_none());
}

#[test]
fn removing_a_repo_clears_it_as_the_default() {
    let s = without_repo(settings(None, &["/a", "/b"], Some("/a")), "/a");
    assert_eq!(s.repos, ["/b"]);
    assert!(s.default_repo.is_none());
    let kept = without_repo(settings(None, &["/a", "/b"], Some("/b")), "/a");
    assert_eq!(kept.default_repo.as_deref(), Some("/b"));
}

#[test]
fn get_set_and_remove_on_disk() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("board-settings.json");
    assert!(store::get(&path, "jira:1").expect("get").is_default());

    let s = settings(Some("Brief"), &["/a"], None);
    assert_eq!(store::set(&path, "jira:1", s.clone()).expect("set"), s);
    store::set(&path, "custom:x", settings(None, &["/a", "/b"], Some("/a"))).expect("set");
    assert_eq!(store::get(&path, "jira:1").expect("get"), s);

    // Saving the defaults removes the entry.
    store::set(&path, "jira:1", BoardSettings::default()).expect("set");
    let raw = std::fs::read_to_string(&path).expect("read");
    assert!(!raw.contains("jira:1"));
    assert!(raw.contains("custom:x"));

    store::remove(&path, "custom:x").expect("remove");
    assert!(store::get(&path, "custom:x").expect("get").is_default());
}

#[test]
fn a_removed_repo_leaves_every_board() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("board-settings.json");
    store::set(&path, "jira:1", settings(None, &["/a", "/b"], Some("/a"))).expect("set");
    store::set(&path, "pylon:open-issues", settings(None, &["/a"], None)).expect("set");
    store::set(&path, "custom:x", settings(Some("Brief"), &["/a"], None)).expect("set");

    store::drop_repo(&path, "/a").expect("drop");
    assert_eq!(
        store::get(&path, "jira:1").expect("get"),
        settings(None, &["/b"], None)
    );
    // Nothing left: the entry goes.
    let raw = std::fs::read_to_string(&path).expect("read");
    assert!(!raw.contains("pylon:open-issues"));
    assert_eq!(
        store::get(&path, "custom:x").expect("get"),
        settings(Some("Brief"), &[], None)
    );
}

#[test]
fn housekeeping_without_a_file_writes_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("board-settings.json");
    store::drop_repo(&path, "/a").expect("drop");
    store::remove(&path, "custom:x").expect("remove");
    assert!(!path.exists());
}
