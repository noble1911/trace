//! The Gallery tab: sets of images an agent pointed the user at (`show_images`).
//! A set is the folders or files it named, canonicalised (`scan::resolve`), kept per
//! workspace (`store`); its images are listed on demand (`scan::list`) and served
//! one by one through the `trace-img` protocol, which admits only image files inside
//! that set (`contain`, `protocol`). The renderer re-lists a shown set every few
//! seconds, which is how new and removed files show up.

pub mod contain;
pub mod glob;
pub mod inline;
pub mod kinds;
pub mod protocol;
pub mod scan;
pub mod store;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

use crate::activity::{self, ActivityKind};
use crate::platform::paths::plain;
use scan::Listing;
use store::GallerySet;

/// The image protocol's name (`trace-img://…`, `http://trace-img.localhost/…` on Windows).
pub const SCHEME: &str = "trace-img";
/// The renderer reloads a workspace's sets when this names it.
pub const SETS_EVENT: &str = "gallery-sets";

/// A set as the renderer gets it: paths as people read them.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SetView {
    pub id: String,
    pub title: String,
    pub roots: Vec<String>,
    pub recursive: bool,
    pub glob: Option<String>,
    pub created_at: i64,
}

impl From<&GallerySet> for SetView {
    fn from(s: &GallerySet) -> Self {
        SetView {
            id: s.id.clone(),
            title: s.title.clone(),
            roots: s
                .roots
                .iter()
                .map(|r| plain(&r.path.to_string_lossy()))
                .collect(),
            recursive: s.recursive,
            glob: s.glob.as_ref().map(|g| g.source().to_string()),
            created_at: s.created_at,
        }
    }
}

/// What `show_images` asks for.
pub struct NewSet<'a> {
    pub inputs: &'a [String],
    pub title: Option<&'a str>,
    pub recursive: bool,
    pub glob: Option<&'a str>,
}

/// Where the agent of `ws` works, for relative paths.
fn agent_cwd(ws: &str) -> Option<PathBuf> {
    if let Some(owner) = crate::commands::session::owning_session(ws) {
        return crate::commands::session_cwd::cwd_of(&owner, false)
            .ok()
            .map(PathBuf::from);
    }
    crate::workspace_dir::work_dir_for(ws)
        .ok()
        .map(|(_, dir)| PathBuf::from(dir))
}

fn default_title(set: &GallerySet) -> String {
    let names: Vec<String> = set
        .roots
        .iter()
        .take(3)
        .map(|r| {
            r.path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        })
        .collect();
    let mut title = names.join(", ");
    if set.roots.len() > 3 {
        title.push_str(&format!(" and {} more", set.roots.len() - 3));
    }
    title
}

fn sets_changed(app: &AppHandle, ws: &str) {
    let target = tauri::EventTarget::Webview {
        label: crate::browser::guard::APP_WEBVIEW.to_string(),
    };
    let _ = app.emit_to(target, SETS_EVENT, json!({ "workspaceId": ws }));
}

/// Make a set from what an agent named and add it to its workspace's Gallery.
pub fn show(app: &AppHandle, ws: &str, new: NewSet) -> Result<(SetView, Listing), String> {
    if ws.is_empty() {
        return Err("trace couldn't tell which workspace these images are for.".into());
    }
    let glob = match new.glob.map(str::trim).filter(|g| !g.is_empty()) {
        Some(g) => Some(glob::Glob::new(g)?),
        None => None,
    };
    let roots = scan::resolve(new.inputs, agent_cwd(ws).as_deref())?;
    let mut set = GallerySet {
        id: crate::helpers::new_id(),
        title: String::new(),
        roots,
        recursive: new.recursive,
        glob,
        created_at: chrono::Utc::now().timestamp_millis(),
    };
    set.title = match new.title.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => t.chars().take(store::MAX_TITLE).collect(),
        None => default_title(&set),
    };
    let listing = scan::list(&set);
    if listing.images.is_empty() {
        return Err(no_images(&set, &listing));
    }
    store::update(ws, |sets| sets.push(set.clone()))?;
    let n = listing.images.len();
    activity::record_agent(
        app,
        ws,
        ActivityKind::ImagesShown,
        &format!(
            "Showed {n} image{} in the Gallery: {}",
            if n == 1 { "" } else { "s" },
            set.title
        ),
        json!({ "count": n, "roots": SetView::from(&set).roots }),
    );
    sets_changed(app, ws);
    Ok((SetView::from(&set), listing))
}

fn no_images(set: &GallerySet, listing: &Listing) -> String {
    let mut why = format!(
        "No images to show in {}",
        SetView::from(set).roots.join(", ")
    );
    if let Some(g) = &set.glob {
        let g = g.source();
        why.push_str(&format!(" matching \"{g}\""));
    }
    why.push_str(&format!(" (the Gallery shows {}).", kinds::listed()));
    if listing.too_large > 0 {
        why.push_str(&format!(
            " {} were over the {} MB cap.",
            listing.too_large,
            kinds::MAX_FILE_BYTES / (1024 * 1024)
        ));
    }
    if !set.recursive && set.roots.iter().any(|r| r.folder) {
        why.push_str(" Pass recursive: true to look in subfolders too.");
    }
    why
}

pub fn sets(ws: &str) -> Result<Vec<SetView>, String> {
    Ok(store::load(ws)?.iter().map(SetView::from).collect())
}

fn find(ws: &str, set_id: &str) -> Result<GallerySet, String> {
    store::load(ws)?
        .iter()
        .find(|s| s.id == set_id)
        .cloned()
        .ok_or_else(|| "That set was removed.".to_string())
}

pub fn listing(ws: &str, set_id: &str) -> Result<Listing, String> {
    Ok(scan::list(&find(ws, set_id)?))
}

pub fn remove(app: &AppHandle, ws: &str, set_id: &str) -> Result<(), String> {
    store::update(ws, |sets| sets.retain(|s| s.id != set_id))?;
    sets_changed(app, ws);
    Ok(())
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub enum OpenHow {
    /// In the system's default app for its type.
    Open,
    /// Selected in the file manager.
    Reveal,
}

/// Open an image of a set, or show it in its folder: only files the set admits.
pub fn open(
    app: &AppHandle,
    ws: &str,
    set_id: &str,
    path: &str,
    how: OpenHow,
) -> Result<(), String> {
    let set = find(ws, set_id)?;
    let file = contain::image_path(&set, path)?;
    // An SVG's default app is often a browser, which would run scripts in it.
    if matches!(how, OpenHow::Open) && kinds::is_svg(&file) {
        return Err("trace doesn't open SVGs in another app, since that app may run scripts in them. Show it in its folder instead.".into());
    }
    let file = plain(&file.to_string_lossy());
    let opener = app.opener();
    match how {
        OpenHow::Open => opener.open_path(file, None::<&str>),
        OpenHow::Reveal => opener.reveal_item_in_dir(&file),
    }
    .map_err(|e| e.to_string())
}
