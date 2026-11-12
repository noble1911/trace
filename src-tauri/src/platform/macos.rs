//! The macOS adapter: the behaviour trace has always had.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

use super::ports::{
    AgentEnvironment, Editor, EditorLauncher, Launcher, ProcessGroup, ProcessHost, SleepHold,
    SleepInhibitor, SoundFolder, SoundPlayer, ToolLocator,
};
use super::{unix, Os};

impl ProcessHost for Os {
    fn prepare(_command: &mut Command) {}

    fn is_alive(pid: u32) -> bool {
        unix::is_alive(pid)
    }

    /// Closing the PTY hangs up the agent's whole session.
    fn stop_tree(_pid: u32) {}

    fn pty_reports_exit() -> bool {
        true
    }

    fn own_group(command: &mut Command) {
        unix::own_group(command);
    }

    fn track_group(child: &Child) -> ProcessGroup {
        unix::track_group(child)
    }
}

impl ToolLocator for Os {
    fn executable_names(name: &str) -> Vec<String> {
        vec![name.to_string()]
    }

    fn user_tool_paths(home: &Path, name: &str) -> Vec<PathBuf> {
        unix::user_tool_paths(home, name)
    }

    /// An app opened from Finder or the Dock has a minimal `PATH` with no Homebrew.
    /// Tailscale from the Mac App Store installs no CLI; its app binary is one.
    fn system_tool_paths(name: &str) -> Vec<PathBuf> {
        let mut paths: Vec<PathBuf> = ["/usr/local/bin", "/opt/homebrew/bin"]
            .iter()
            .map(|dir| Path::new(dir).join(name))
            .collect();
        if name == "tailscale" {
            paths.push(PathBuf::from(
                "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
            ));
        }
        paths
    }

    fn project_wrapper(dir: &Path, name: &str) -> PathBuf {
        dir.join(name)
    }

    fn pty_invocation(tool: &str) -> Vec<String> {
        vec![tool.to_string()]
    }
}

impl AgentEnvironment for Os {
    fn capture_env() -> HashMap<String, String> {
        unix::login_shell_env("/bin/zsh")
    }

    fn extra_path_dirs(home: &Path) -> Vec<PathBuf> {
        let mut dirs = vec![home.join(".local/bin")];
        dirs.extend(
            ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
                .iter()
                .map(PathBuf::from),
        );
        dirs
    }

    fn default_shell() -> String {
        unix::default_shell("/bin/bash")
    }

    fn shell_line(line: &str) -> Command {
        unix::shell_line(line)
    }
}

impl SoundPlayer for Os {
    /// macOS ships well-made alert sounds, and keeps the user's own beside them.
    fn sound_folders(home: &Path) -> Vec<SoundFolder> {
        vec![
            SoundFolder {
                path: PathBuf::from("/System/Library/Sounds"),
                source: "system",
            },
            SoundFolder {
                path: home.join("Library/Sounds"),
                source: "you",
            },
        ]
    }

    fn audio_extensions() -> &'static [&'static str] {
        &["aiff", "aif", "wav", "mp3", "m4a", "caf", "aac"]
    }

    fn play(path: &Path) -> io::Result<Child> {
        unix::play_with(&["afplay"], path)
    }
}

impl SleepInhibitor for Os {
    /// `caffeinate -i` stops idle sleep but lets the display sleep, and `-w` ties it to
    /// trace's pid, so it exits by itself if trace is killed.
    fn hold() -> Option<SleepHold> {
        let mut command = super::process::command("caffeinate");
        command.args(["-i", "-w", &std::process::id().to_string()]);
        unix::hold_with(command)
    }
}

impl EditorLauncher for Os {
    /// Bundle ids first, so an editor with no CLI on `PATH` still opens.
    fn launchers(editor: Editor) -> Vec<Launcher> {
        match editor {
            Editor::VsCode => vec![
                ("open", &["-b", "com.microsoft.VSCode"]),
                ("open", &["-b", "com.microsoft.VSCodeInsiders"]),
                ("open", &["-a", "Visual Studio Code"]),
                ("code", &[]),
            ],
            Editor::IntelliJ => vec![
                ("open", &["-b", "com.jetbrains.intellij"]),
                ("open", &["-b", "com.jetbrains.intellij.ce"]),
                ("open", &["-a", "IntelliJ IDEA"]),
                ("open", &["-a", "IntelliJ IDEA CE"]),
                ("idea", &[]),
            ],
            Editor::Cursor => vec![("open", &["-a", "Cursor"]), ("cursor", &[])],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_ships_sounds_to_offer() {
        // Every Mac has this one; the listing is what fills the Settings picker.
        let home = dirs::home_dir().unwrap_or_default();
        let system = Os::sound_folders(&home).remove(0);
        assert_eq!(system.source, "system");
        assert!(system.path.join("Glass.aiff").is_file());
        assert!(Os::audio_extensions().contains(&"aiff"));
    }
}
