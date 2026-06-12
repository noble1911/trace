//! Open an issue's workspace in a desktop editor. Ported from the original
//! project's open button. Tries OS-native launchers first (bundle ids on macOS),
//! then the editor's CLI binary on PATH. Falls back to the repo root when the
//! worktree doesn't exist yet.

use std::path::Path;
use std::process::{Command, Stdio};


/// Run a launcher binary detached, reporting whether it started successfully.
fn try_launch(binary: &str, args: &[&str]) -> bool {
    Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn open_vscode(path: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        if try_launch("open", &["-b", "com.microsoft.VSCode", path])
            || try_launch("open", &["-b", "com.microsoft.VSCodeInsiders", path])
            || try_launch("open", &["-a", "Visual Studio Code", path])
        {
            return true;
        }
    }
    try_launch("code", &[path])
}

fn open_intellij(path: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        if try_launch("open", &["-b", "com.jetbrains.intellij", path])
            || try_launch("open", &["-b", "com.jetbrains.intellij.ce", path])
            || try_launch("open", &["-a", "IntelliJ IDEA", path])
            || try_launch("open", &["-a", "IntelliJ IDEA CE", path])
        {
            return true;
        }
    }
    if try_launch("idea", &[path]) {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        if try_launch("idea64.exe", &[path]) {
            return true;
        }
    }
    false
}

fn open_cursor(path: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        if try_launch("open", &["-a", "Cursor", path]) {
            return true;
        }
    }
    try_launch("cursor", &[path])
}

/// Open the issue's worktree (or the repo root if no worktree yet) in `editor`.
#[tauri::command]
pub fn open_in_editor(issue_key: String, editor: String) -> Result<(), String> {
    // The issue's assigned repo, or the default repo if it hasn't been started.
    let repo = crate::commands::repos::repo_for(&issue_key)
        .ok()
        .or_else(crate::commands::repos::default_repo)
        .ok_or("Add a repository in Settings first.")?;
    let worktree = crate::commands::repos::workspace_dir(&repo, &issue_key);
    let path = if Path::new(&worktree).exists() { worktree } else { repo };

    let opened = match editor.trim().to_lowercase().as_str() {
        "vscode" | "code" => open_vscode(&path),
        "intellij" | "idea" => open_intellij(&path),
        "cursor" => open_cursor(&path),
        other => return Err(format!("Unsupported editor: {other}")),
    };

    if opened {
        Ok(())
    } else {
        Err(format!("Couldn't open {editor}. Make sure it's installed and on your PATH."))
    }
}
