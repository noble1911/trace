use serde_json::json;

use super::*;

fn tree(paths: &[(&str, bool)]) -> Vec<Entry> {
    paths
        .iter()
        .map(|(p, dir)| Entry {
            path: p.to_string(),
            is_dir: *dir,
            sha: format!("sha:{p}"),
        })
        .collect()
}

#[test]
fn tree_entries_read_githubs_answer() {
    let answer = json!({ "tree": [
        { "path": "a", "type": "tree", "sha": "t1" },
        { "path": "a/SKILL.md", "type": "blob", "sha": "b1" },
        { "path": "sub", "type": "commit", "sha": "c1" },
        { "type": "blob" }
    ] });
    let entries = tree_entries(&answer);
    assert_eq!(entries.len(), 3);
    assert!(entries[0].is_dir);
    assert!(!entries[2].is_dir, "a submodule isn't a folder to look in");
}

#[test]
fn every_skill_md_folder_is_a_skill() {
    let entries = tree(&[
        ("SKILL.md", false),
        ("skills", true),
        ("skills/b", true),
        ("skills/b/SKILL.md", false),
        ("skills/a", true),
        ("skills/a/SKILL.md", false),
        ("skills/a/ref.md", false),
        ("node_modules/x", true),
        ("node_modules/x/SKILL.md", false),
    ]);
    let (found, truncated) = skills(&entries);
    assert!(!truncated);
    let folders: Vec<&str> = found.iter().map(|s| s.folder.as_str()).collect();
    assert_eq!(folders, ["skills/a", "skills/b"]);
    assert_eq!(found[0].folder_sha, "sha:skills/a");
    assert_eq!(found[0].skill_md, "sha:skills/a/SKILL.md");
}

#[test]
fn a_huge_repo_is_capped() {
    let mut paths = Vec::new();
    for i in 0..MAX_SKILLS + 5 {
        paths.push((format!("s/{i:03}"), true));
        paths.push((format!("s/{i:03}/SKILL.md"), false));
    }
    let refs: Vec<(&str, bool)> = paths.iter().map(|(p, d)| (p.as_str(), *d)).collect();
    let (found, truncated) = skills(&tree(&refs));
    assert_eq!(found.len(), MAX_SKILLS);
    assert!(truncated);
}

#[test]
fn a_marketplace_lists_its_plugins_and_where_they_live() {
    let manifest = json!({
        "name": "team",
        "plugins": [
            { "name": "delivery", "source": "./delivery", "description": "Ship it", "version": "0.9.2" },
            { "name": "nested", "source": "plugins//support/" },
            { "name": "remote", "source": { "source": "github", "repo": "o/r" } },
            { "name": "escape", "source": "../elsewhere" },
            { "source": "./nameless" }
        ]
    });
    let (name, plugins) = marketplace(&manifest).expect("manifest");
    assert_eq!(name, "team");
    let got: Vec<(&str, Option<&str>)> = plugins
        .iter()
        .map(|p| (p.name.as_str(), p.folder.as_deref()))
        .collect();
    assert_eq!(
        got,
        [
            ("delivery", Some("delivery")),
            ("nested", Some("plugins/support")),
            ("remote", None),
            ("escape", None),
        ]
    );
    assert_eq!(plugins[0].version.as_deref(), Some("0.9.2"));
    assert!(marketplace(&json!({ "plugins": [] })).is_err());
}

#[test]
fn a_plugin_owns_the_skills_under_its_folder() {
    let entries = tree(&[
        ("delivery/skills/ship", true),
        ("delivery/skills/ship/SKILL.md", false),
        ("delivery-old/skills/x", true),
        ("delivery-old/skills/x/SKILL.md", false),
        ("support/skills/triage", true),
        ("support/skills/triage/SKILL.md", false),
    ]);
    let (all, _) = skills(&entries);
    let mine: Vec<&str> = under(&all, "delivery")
        .iter()
        .map(|s| s.folder.as_str())
        .collect();
    assert_eq!(
        mine,
        ["delivery/skills/ship"],
        "not a folder that only starts the same"
    );
    assert_eq!(under(&all, "").len(), 3);
}

#[test]
fn frontmatter_in_its_usual_forms() {
    let plain = "---\nname: ship-story\ndescription: Ship the current story.\n---\n# Body";
    assert_eq!(
        frontmatter(plain),
        (
            Some("ship-story".into()),
            Some("Ship the current story.".into())
        )
    );
    let quoted = "---\nname: \"pick\"\ndescription: 'It''s next: pick it'\n---";
    assert_eq!(
        frontmatter(quoted),
        (Some("pick".into()), Some("It's next: pick it".into()))
    );
    let folded = "---\ndescription: >\n  Two lines\n  folded.\nname: x\n---";
    assert_eq!(frontmatter(folded).1.as_deref(), Some("Two lines folded."));
    let literal = "---\ndescription: |\n  one\n  two\n---";
    assert_eq!(frontmatter(literal).1.as_deref(), Some("one\ntwo"));
    let nested = "---\nmetadata:\n  name: inner\n---";
    assert_eq!(
        frontmatter(nested),
        (None, None),
        "an indented key isn't the skill's"
    );
    assert_eq!(frontmatter("# No frontmatter"), (None, None));
    assert_eq!(
        frontmatter("\u{feff}---\nname: bom\n---").0.as_deref(),
        Some("bom")
    );
}
