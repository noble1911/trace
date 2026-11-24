//! `claude plugin`'s arguments and answers, on output recorded from Claude Code
//! 2.1.331 (installing `support@obsidian` into a scratch project and back out).

use super::*;

const LIST: &str = r#"[
  {"id":"delivery@obsidian","version":"0.9.2","scope":"user","enabled":true,
   "installPath":"/Users/me/.claude/plugins/cache/obsidian/delivery/0.9.2",
   "installedAt":"2026-10-22T15:41:00.490Z","lastUpdated":"2026-11-17T09:50:03.252Z",
   "projectEnabled":false},
  {"id":"support@obsidian","version":"0.1.0","scope":"project","enabled":true,
   "installPath":"/Users/me/.claude/plugins/cache/obsidian/support/0.1.0",
   "installedAt":"2026-11-24T14:11:44.558Z","lastUpdated":"2026-11-24T14:11:44.558Z",
   "projectPath":"/private/tmp/sk-probe.XBpi","projectEnabled":true},
  {"id":"corp@it","version":"1.0.0","scope":"managed","enabled":true},
  {"id":"broken","scope":42}
]"#;

#[test]
fn reads_what_is_installed_and_skips_what_it_cannot() {
    let all = parse_list(LIST).expect("parses");
    assert_eq!(all.len(), 3, "the malformed entry is skipped, not fatal");
    assert_eq!(all[0].id, "delivery@obsidian");
    assert_eq!(all[0].scope, Scope::User);
    assert_eq!(all[0].project_path, None);
    assert_eq!(all[1].scope, Scope::Project);
    assert_eq!(
        all[1].project_path.as_deref(),
        Some("/private/tmp/sk-probe.XBpi")
    );
    assert_eq!(
        all[2].scope,
        Scope::Other,
        "a scope trace doesn't install into"
    );
}

#[test]
fn an_unreadable_list_is_an_error() {
    assert!(parse_list("Not logged in").is_err());
}

#[test]
fn a_successful_install_says_so() {
    let out = r#"{"command":"install","outcome":"ok","plugin":"support@obsidian","pluginId":"support@obsidian","scope":"project","message":"Successfully installed plugin: support@obsidian (scope: project)"}"#;
    assert_eq!(
        parse_outcome(out, ""),
        Ok("Successfully installed plugin: support@obsidian (scope: project)".into())
    );
}

#[test]
fn a_failed_install_gives_claude_codes_reason() {
    let out = r#"{"command":"install","outcome":"failed","plugin":"nosuch@obsidian","scope":"project","message":"Plugin \"nosuch\" not found in marketplace \"obsidian\"","failureCode":"not_found"}"#;
    let err = "✘ Failed to install plugin \"nosuch@obsidian\": …";
    assert_eq!(
        parse_outcome(out, err),
        Err("Plugin \"nosuch\" not found in marketplace \"obsidian\"".into())
    );
}

#[test]
fn the_answer_is_the_last_json_line() {
    let out =
        "Updating marketplace…\n{\"progress\":1}\n{\"outcome\":\"ok\",\"message\":\"done\"}\n";
    assert_eq!(parse_outcome(out, ""), Ok("done".into()));
}

#[test]
fn no_answer_falls_back_to_stderr() {
    assert_eq!(
        parse_outcome("", "✘ error: unknown option '--json'\n"),
        Err("error: unknown option '--json'".into())
    );
}

#[test]
fn installs_from_the_source_repo_into_one_scope() {
    assert_eq!(
        install_args("support", "ObsidianResearch/skills", Scope::Local).expect("args"),
        [
            "plugin",
            "install",
            "support",
            "--marketplace",
            "ObsidianResearch/skills",
            "--scope",
            "local",
            "--json"
        ]
    );
}

#[test]
fn never_accepts_a_declared_command_by_itself() {
    let args = install_args("support", "o/r", Scope::User).expect("args");
    assert!(!args.iter().any(|a| a == "-y" || a == "--yes"));
}

#[test]
fn an_update_rereads_the_marketplace_first() {
    let [refresh, update] = update_args("support@obsidian", Scope::User).expect("args");
    assert_eq!(
        refresh,
        ["plugin", "marketplace", "update", "obsidian", "--json"]
    );
    assert_eq!(
        update,
        [
            "plugin",
            "update",
            "support@obsidian",
            "--scope",
            "user",
            "--json"
        ]
    );
}

#[test]
fn refuses_names_that_could_be_read_as_more() {
    for bad in ["", "-y", "--scope", ".hidden", "a b", "a/b", "a;rm", "a@b"] {
        assert!(!is_name(bad), "{bad:?}");
    }
    assert!(is_name("triage-bug_2.0"));
    assert!(install_args("--yes", "o/r", Scope::User).is_err());
    assert!(
        uninstall_args("support", Scope::User).is_err(),
        "needs @marketplace"
    );
    assert!(uninstall_args("support@-x", Scope::User).is_err());
    assert!(uninstall_args("support@obsidian", Scope::Other).is_err());
    assert_eq!(
        plugin_id("support", "obsidian"),
        Ok("support@obsidian".into())
    );
}
