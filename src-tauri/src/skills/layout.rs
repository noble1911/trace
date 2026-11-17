//! What a skills repo holds, worked out from its file list (one recursive git
//! tree) and, for a marketplace, its `marketplace.json`. Pure: no network, so
//! every layout rule is a unit test. `source.rs` fetches; this decides.
//!
//! - A repo with `.claude-plugin/marketplace.json` is a **plugin marketplace**.
//!   Each plugin whose `source` is a folder in the repo owns the `SKILL.md`s
//!   under that folder; one from elsewhere (a git URL) is listed without its
//!   skills, which Claude Code fetches when it installs it.
//! - Any other repo with `SKILL.md`s is **skill folders**: each `SKILL.md`'s
//!   folder is one skill.

use serde::Serialize;
use serde_json::Value;

/// The marketplace manifest's path in a repo.
pub const MARKETPLACE: &str = ".claude-plugin/marketplace.json";
/// Most skills one source lists (each costs a request for its description).
pub const MAX_SKILLS: usize = 150;

/// One entry of a git tree: a path, whether it's a folder, and its SHA (a
/// folder's SHA changes when anything inside it does: how updates are seen).
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub path: String,
    pub is_dir: bool,
    pub sha: String,
}

/// The entries of a `GET /repos/…/git/trees/<ref>?recursive=1` answer.
pub fn tree_entries(tree: &Value) -> Vec<Entry> {
    let Some(items) = tree.get("tree").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|i| {
            Some(Entry {
                path: i.get("path")?.as_str()?.to_string(),
                is_dir: i.get("type")?.as_str()? == "tree",
                sha: i.get("sha")?.as_str()?.to_string(),
            })
        })
        .collect()
}

/// A skill's folder in the repo, the blob SHA of its `SKILL.md` (to read its
/// description) and the folder's tree SHA.
#[derive(Debug, Clone, PartialEq)]
pub struct SkillAt {
    pub folder: String,
    pub skill_md: String,
    pub folder_sha: String,
}

/// Every skill in the tree, in path order, at most `MAX_SKILLS`. A `SKILL.md`
/// at the repo root, or under `node_modules`, isn't one.
pub fn skills(entries: &[Entry]) -> (Vec<SkillAt>, bool) {
    let mut found: Vec<SkillAt> = entries
        .iter()
        .filter(|e| !e.is_dir && (e.path.ends_with("/SKILL.md")))
        .filter(|e| !e.path.split('/').any(|p| p == "node_modules"))
        .filter_map(|e| {
            let folder = e.path.strip_suffix("/SKILL.md")?.to_string();
            let folder_sha = entries
                .iter()
                .find(|d| d.is_dir && d.path == folder)
                .map(|d| d.sha.clone())?;
            Some(SkillAt {
                folder,
                skill_md: e.sha.clone(),
                folder_sha,
            })
        })
        .collect();
    found.sort_by(|a, b| a.folder.cmp(&b.folder));
    let truncated = found.len() > MAX_SKILLS;
    found.truncate(MAX_SKILLS);
    (found, truncated)
}

/// A plugin a marketplace lists.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    /// Its folder in this repo (`delivery`); None when it lives elsewhere.
    pub folder: Option<String>,
}

/// The marketplace's own name (what Claude Code calls it: `delivery@<name>`)
/// and its plugins.
pub fn marketplace(manifest: &Value) -> Result<(String, Vec<PluginEntry>), String> {
    let name = manifest
        .get("name")
        .and_then(Value::as_str)
        .filter(|n| !n.trim().is_empty())
        .ok_or("Its marketplace.json has no name.")?
        .to_string();
    let text = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    let plugins = manifest
        .get("plugins")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|p| {
                    Some(PluginEntry {
                        name: text(p, "name")?,
                        description: text(p, "description"),
                        version: text(p, "version"),
                        folder: p
                            .get("source")
                            .and_then(Value::as_str)
                            .and_then(local_folder),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok((name, plugins))
}

/// A plugin `source` that is a folder of this repo (`./delivery`, `plugins/x`),
/// normalised (`delivery`); None for a URL, an absolute path or one leaving the repo.
fn local_folder(source: &str) -> Option<String> {
    if source.contains("://") || source.starts_with('/') {
        return None;
    }
    let parts: Vec<&str> = source
        .split('/')
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    if parts.iter().any(|p| *p == "..") {
        return None;
    }
    Some(parts.join("/"))
}

/// The skills under `folder` (`""`, the repo root, owns them all).
pub fn under<'a>(skills: &'a [SkillAt], folder: &str) -> Vec<&'a SkillAt> {
    skills
        .iter()
        .filter(|s| folder.is_empty() || s.folder.starts_with(&format!("{folder}/")))
        .collect()
}

/// A `SKILL.md`'s `name` and `description` from its YAML frontmatter: plain,
/// quoted, or a folded/literal block (`description: >` then indented lines).
/// Either is None when the file doesn't say.
pub fn frontmatter(text: &str) -> (Option<String>, Option<String>) {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let body: Vec<&str> = lines.take_while(|l| l.trim() != "---").collect();
    (field(&body, "name"), field(&body, "description"))
}

fn field(lines: &[&str], key: &str) -> Option<String> {
    let at = lines.iter().position(|l| {
        l.strip_prefix(key)
            .is_some_and(|rest| rest.trim_start().starts_with(':'))
    })?;
    let value = lines[at][key.len()..].trim_start()[1..].trim();
    let joined = if value.is_empty() || value.starts_with('>') || value.starts_with('|') {
        let folded = !value.starts_with('|');
        let block: Vec<&str> = lines[at + 1..]
            .iter()
            .take_while(|l| l.trim().is_empty() || l.starts_with([' ', '\t']))
            .map(|l| l.trim())
            .collect();
        block
            .join(if folded { " " } else { "\n" })
            .trim()
            .to_string()
    } else {
        unquote(value)
    };
    (!joined.is_empty()).then_some(joined)
}

fn unquote(v: &str) -> String {
    let quoted = |q: char| v.len() >= 2 && v.starts_with(q) && v.ends_with(q);
    if quoted('"') {
        v[1..v.len() - 1].replace("\\\"", "\"")
    } else if quoted('\'') {
        v[1..v.len() - 1].replace("''", "'")
    } else {
        v.to_string()
    }
}

#[cfg(test)]
#[path = "layout_tests.rs"]
mod tests;
