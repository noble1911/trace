//! Whether a set may show a file. The image protocol and the open/reveal actions
//! ask this for every path the renderer names: the path is canonicalised (so `..`
//! and symlinks resolve to where the file really is), must be an image by its real
//! name, under the size cap, and inside one of the set's roots the way the set was
//! made (a direct child unless it's recursive, and matching its glob). A chat's
//! images (`inline`) get the same checks bar the set.

use std::fs;
use std::path::{Path, PathBuf};

use super::kinds::{self, MAX_DEPTH, MAX_FILE_BYTES};
use super::store::GallerySet;

/// Whether `canon` (already canonical) is one of `set`'s files.
pub fn admits(set: &GallerySet, canon: &Path) -> bool {
    set.roots.iter().any(|root| {
        if !root.folder {
            return canon == root.path;
        }
        let Ok(rel) = canon.strip_prefix(&root.path) else {
            return false;
        };
        let depth = rel.components().count();
        if depth == 0 || depth > MAX_DEPTH + 1 || (!set.recursive && depth != 1) {
            return false;
        }
        let rel = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        set.glob.as_ref().is_none_or(|g| g.matches(&rel))
    })
}

/// The real file behind `requested`, if `set` may show it; else why not.
pub fn image_path(set: &GallerySet, requested: &str) -> Result<PathBuf, String> {
    let canon = image_file(requested)?;
    if !admits(set, &canon) {
        return Err("That file isn't in this set.".into());
    }
    Ok(canon)
}

/// The real file behind `requested` if it's an image trace will serve at all
/// (absolute, an image by its real name, a file, under the size cap), with no
/// set to be inside: a set's checks start here, and so do a chat's images
/// (`inline`).
pub fn image_file(requested: &str) -> Result<PathBuf, String> {
    let given = Path::new(requested);
    if !given.is_absolute() {
        return Err("Not an absolute path.".into());
    }
    let canon = fs::canonicalize(given).map_err(|_| "No such file.".to_string())?;
    if kinds::mime_for(&canon).is_none() {
        return Err("Not an image.".into());
    }
    let meta = fs::metadata(&canon).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Not a file.".into());
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err("Over the Gallery's size cap.".into());
    }
    Ok(canon)
}

#[cfg(test)]
#[path = "contain_tests.rs"]
mod tests;
