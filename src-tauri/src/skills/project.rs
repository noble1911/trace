//! A project's own record of its plugins, read from git and files, not Claude
//! Code: what its default branch enables for everyone, and carrying a person's
//! uncommitted *Just me* settings into the worktrees agents run in.

use std::path::Path;

use serde_json::Value;

/// The committed file that enables a project's plugins for everyone.
const SHARED: &str = ".claude/settings.json";
/// The uncommitted one that enables them for this person on the project.
const LOCAL: &str = ".claude/settings.local.json";

/// The plugin ids a Claude Code settings file turns on (`enabledPlugins`, each
/// `"<plugin>@<marketplace>": true`). Unreadable JSON turns none on.
pub fn enabled_in(settings: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<Value>(settings) else {
        return Vec::new();
    };
    let Some(map) = v.get("enabledPlugins").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = map
        .iter()
        .filter(|(_, on)| on.as_bool() == Some(true))
        .map(|(id, _)| id.clone())
        .collect();
    ids.sort();
    ids
}

/// Plugins `repo` enables for everyone on the branch new worktrees start from
/// (`origin/<default>`, else the local default branch). These come with the repo,
/// so offering to install them there again would only make a second record.
pub fn committed_plugins(repo: &str) -> Vec<String> {
    let default = crate::git::get_default_branch(repo);
    [format!("origin/{default}"), default]
        .iter()
        .find_map(|rev| git_show(repo, &format!("{rev}:{SHARED}")))
        .map(|text| enabled_in(&text))
        .unwrap_or_default()
}

fn git_show(repo: &str, object: &str) -> Option<String> {
    let out = crate::claude::discovery::command("git")
        .args(["show", object])
        .current_dir(repo)
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Give a new worktree the main checkout's `.claude/settings.local.json`: it isn't
/// committed, so it doesn't come with the branch, and without it a plugin
/// installed *Just me* on the project would be missing from every agent there.
/// A worktree that already has one keeps its own.
pub fn carry_local_settings(repo: &Path, worktree: &Path) -> std::io::Result<()> {
    let (from, to) = (repo.join(LOCAL), worktree.join(LOCAL));
    if !from.is_file() || to.exists() {
        return Ok(());
    }
    if let Some(dir) = to.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::copy(from, to).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_plugins_a_settings_file_turns_on() {
        let settings = r#"{
          "permissions": {"allow": ["Bash(npm test)"]},
          "enabledPlugins": {"support@obsidian": true, "delivery@obsidian": true, "old@x": false}
        }"#;
        assert_eq!(
            enabled_in(settings),
            ["delivery@obsidian", "support@obsidian"]
        );
    }

    #[test]
    fn a_file_without_plugins_or_not_json_turns_none_on() {
        assert!(enabled_in(r#"{"permissions":{}}"#).is_empty());
        assert!(enabled_in(r#"{"enabledPlugins":["a@b"]}"#).is_empty());
        assert!(enabled_in("{ not json").is_empty());
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("trace-skills-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    #[test]
    fn a_new_worktree_gets_the_local_settings() {
        let (repo, wt) = (scratch("repo-a"), scratch("wt-a"));
        std::fs::create_dir_all(repo.join(".claude")).expect("dir");
        std::fs::write(repo.join(LOCAL), r#"{"enabledPlugins":{"a@b":true}}"#).expect("write");
        carry_local_settings(&repo, &wt).expect("copies");
        let copied = std::fs::read_to_string(wt.join(LOCAL)).expect("copied");
        assert_eq!(enabled_in(&copied), ["a@b"]);
    }

    #[test]
    fn a_worktree_keeps_its_own_and_nothing_is_made_from_nothing() {
        let (repo, wt) = (scratch("repo-b"), scratch("wt-b"));
        carry_local_settings(&repo, &wt).expect("nothing to copy");
        assert!(!wt.join(".claude").exists(), "no empty folder");

        std::fs::create_dir_all(repo.join(".claude")).expect("dir");
        std::fs::create_dir_all(wt.join(".claude")).expect("dir");
        std::fs::write(repo.join(LOCAL), "{}").expect("write");
        std::fs::write(wt.join(LOCAL), "mine").expect("write");
        carry_local_settings(&repo, &wt).expect("leaves it");
        assert_eq!(
            std::fs::read_to_string(wt.join(LOCAL)).expect("read"),
            "mine"
        );
    }
}
