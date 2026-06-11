//! Session organisation: user-defined **tabs** (top-level views on the
//! Sessions page) and collapsible **sections** within a tab. Stored as one
//! ordered structure in `session-groups.json` — array order IS display
//! order, so the frontend manipulates the whole structure and saves it back;
//! the only invariants enforced here are sane names and no dangling refs.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::helpers::restrict_perms;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionSection {
    pub id: String,
    pub name: String,
    /// Owning tab id; `None` = the default tab.
    #[serde(default)]
    pub tab: Option<String>,
    /// Collapsed state persists with the data, not per-machine UI state —
    /// the layout is the user's filing system, not a transient preference.
    #[serde(default)]
    pub collapsed: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionGroups {
    #[serde(default)]
    pub tabs: Vec<SessionTab>,
    #[serde(default)]
    pub sections: Vec<SessionSection>,
}

fn groups_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("session-groups.json")
}

pub(crate) fn load() -> SessionGroups {
    std::fs::read_to_string(groups_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(groups: &SessionGroups) -> Result<(), String> {
    let path = groups_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(groups).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    restrict_perms(&path);
    Ok(())
}

/// Tabs + sections, in display order.
#[tauri::command]
pub fn list_session_groups() -> SessionGroups {
    load()
}

/// Enforce the structure's invariants: trimmed non-empty names, and sections
/// always pointing at a tab that exists (a deleted tab's sections fall back
/// to the default tab — never lost).
fn sanitize(mut groups: SessionGroups) -> SessionGroups {
    groups.tabs.retain_mut(|t| {
        t.name = t.name.trim().to_string();
        !t.name.is_empty() && !t.id.is_empty()
    });
    let tab_ids: Vec<&str> = groups.tabs.iter().map(|t| t.id.as_str()).collect();
    let mut sections: Vec<SessionSection> = Vec::new();
    for mut s in groups.sections.drain(..) {
        s.name = s.name.trim().to_string();
        if s.name.is_empty() || s.id.is_empty() {
            continue;
        }
        if let Some(tab) = &s.tab {
            if !tab_ids.contains(&tab.as_str()) {
                s.tab = None;
            }
        }
        sections.push(s);
    }
    groups.sections = sections;
    groups
}

/// Replace the whole structure (the frontend owns ordering/manipulation).
/// Sanitizes, persists, clears session refs to ids that no longer exist, and
/// returns the sanitized structure so the frontend can reconcile.
#[tauri::command]
pub fn save_session_groups(groups: SessionGroups) -> Result<SessionGroups, String> {
    let groups = sanitize(groups);
    save(&groups)?;
    crate::commands::session::reconcile_groups(&groups)?;
    Ok(groups)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(id: &str, name: &str) -> SessionTab {
        SessionTab { id: id.into(), name: name.into() }
    }
    fn section(id: &str, name: &str, tab: Option<&str>) -> SessionSection {
        SessionSection {
            id: id.into(),
            name: name.into(),
            tab: tab.map(str::to_string),
            collapsed: false,
        }
    }

    #[test]
    fn trims_names_and_drops_empties() {
        let out = sanitize(SessionGroups {
            tabs: vec![tab("a", "  repo1  "), tab("b", "   "), tab("", "ghost")],
            sections: vec![section("s1", "  ok  ", None), section("s2", "", None)],
        });
        assert_eq!(out.tabs.len(), 1);
        assert_eq!(out.tabs[0].name, "repo1");
        assert_eq!(out.sections.len(), 1);
        assert_eq!(out.sections[0].name, "ok");
    }

    #[test]
    fn rehomes_sections_of_deleted_tab() {
        let out = sanitize(SessionGroups {
            tabs: vec![tab("kept", "Kept")],
            sections: vec![section("s1", "Orphan", Some("deleted")), section("s2", "Home", Some("kept"))],
        });
        assert_eq!(out.sections[0].tab, None);
        assert_eq!(out.sections[1].tab.as_deref(), Some("kept"));
    }

    #[test]
    fn preserves_order() {
        let out = sanitize(SessionGroups {
            tabs: vec![tab("1", "a"), tab("2", "b"), tab("3", "c")],
            sections: vec![],
        });
        let ids: Vec<&str> = out.tabs.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["1", "2", "3"]);
    }
}
