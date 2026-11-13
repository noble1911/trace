use super::*;

#[test]
fn a_repo_is_named_by_its_remote_else_its_folder() {
    let with = summarize("/home/dev/widgets", Some(("github.com", "acme/widgets")));
    assert_eq!(with.name, "acme/widgets");
    assert_eq!(with.remote.as_deref(), Some("github.com/acme/widgets"));
    let without = summarize("/home/dev/scratch", None);
    assert_eq!(without.name, "scratch");
    assert_eq!(without.remote, None);
}

#[test]
fn no_local_path_reaches_the_wire() {
    let caps = ServerCapabilities::new(
        "box",
        vec!["claude".into()],
        vec![summarize("/home/dev/secret-folder/widgets", None)],
    );
    let json = serde_json::to_string(&caps).expect("serializes");
    assert!(!json.contains("/home"));
    assert!(!json.contains("secret-folder"));
}

#[test]
fn capabilities_carry_the_version_name_os_agents_and_repos() {
    let caps = ServerCapabilities::new("box", vec!["claude".into(), "codex".into()], vec![]);
    let json = serde_json::to_value(&caps).expect("serializes");
    assert_eq!(json["protocol"], super::super::protocol::PROTOCOL_VERSION);
    assert_eq!(json["name"], "box");
    assert_eq!(json["os"], std::env::consts::OS);
    assert_eq!(json["agents"][1], "codex");
    assert_eq!(json["features"]["turnHooks"], true);
}

#[test]
fn a_newer_or_older_server_still_reads() {
    let caps: ServerCapabilities =
        serde_json::from_str(r#"{"name":"old","somethingNew":1}"#).expect("lenient");
    assert_eq!(caps.name, "old");
    assert!(caps.agents.is_empty() && caps.repos.is_empty());
}
