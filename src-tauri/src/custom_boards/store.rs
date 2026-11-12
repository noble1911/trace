//! `custom-boards.json` in the app config dir, through `helpers::persist`: atomic
//! `0600` writes, reads that never turn an IO error into an empty file, and
//! locked read-modify-writes so two windows (or the dev and installed builds)
//! can't lose each other's cards.

use std::path::{Path, PathBuf};

use super::model::BoardsFile;
use crate::helpers::persist::{self, Style};

/// Where the boards live.
pub fn default_path() -> PathBuf {
    crate::helpers::trace_dir().join("custom-boards.json")
}

/// The file as it is now (empty when there isn't one yet).
pub fn load(path: &Path) -> Result<BoardsFile, String> {
    persist::read_or_default(path)
}

/// Apply `f` under the file's lock and save the result, all or nothing: `f` runs
/// on a copy, so one that fails half way (a refusal found after a change) leaves
/// the file exactly as it was.
pub fn edit<R>(
    path: &Path,
    f: impl FnOnce(&mut BoardsFile) -> Result<R, String>,
) -> Result<R, String> {
    persist::update(path, Style::Pretty, |file: &mut BoardsFile| {
        let mut draft = file.clone();
        let out = f(&mut draft)?;
        *file = draft;
        Ok(out)
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_edit_writes_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("custom-boards.json");
        edit(&path, |f| {
            f.last_number = 4;
            Ok(())
        })
        .expect("first edit");
        let refused: Result<(), String> = edit(&path, |f| {
            f.last_number = 9;
            Err("no".to_string())
        });
        assert!(refused.is_err());
        assert_eq!(load(&path).expect("load").last_number, 4);
    }

    #[test]
    fn a_missing_file_is_empty() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = load(&dir.path().join("none.json")).expect("load");
        assert!(file.boards.is_empty());
        assert_eq!(file.last_number, 0);
    }
}
