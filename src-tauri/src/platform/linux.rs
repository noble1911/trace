//! The Linux adapter. Mostly `unix`, plus install locations, sound players and cleaning
//! up after the AppImage runtime.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

use super::ports::{
    AgentEnvironment, Editor, EditorLauncher, Launcher, ProcessGroup, ProcessHost, SleepHold,
    SleepInhibitor, SoundFolder, SoundPlayer, ToolLocator,
};
use super::{unix, Os};

/// Variables an AppImage sets up for itself. Children inherit them, and system tools
/// then load the wrong libraries: `git` and `gh` can fail in ways that look unrelated.
const APPIMAGE_ENV: [&str; 13] = [
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "GDK_PIXBUF_MODULE_FILE",
    "GIO_EXTRA_MODULES",
    "GSETTINGS_SCHEMA_DIR",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
];

fn in_appimage() -> bool {
    std::env::var_os("APPIMAGE").is_some()
}

/// `PATH` without the AppImage's own directories.
fn path_without(path: &str, appdir: &str) -> String {
    path.split(':')
        .filter(|dir| !dir.starts_with(appdir))
        .collect::<Vec<_>>()
        .join(":")
}

impl ProcessHost for Os {
    fn prepare(command: &mut Command) {
        if !in_appimage() {
            return;
        }
        for key in APPIMAGE_ENV {
            command.env_remove(key);
        }
        if let (Ok(path), Ok(appdir)) = (std::env::var("PATH"), std::env::var("APPDIR")) {
            command.env("PATH", path_without(&path, &appdir));
        }
    }

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

    /// A desktop launcher can start apps with a short `PATH`.
    fn system_tool_paths(name: &str) -> Vec<PathBuf> {
        ["/usr/local/bin", "/usr/bin", "/snap/bin"]
            .iter()
            .map(|dir| Path::new(dir).join(name))
            .collect()
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
        // The login shell inherits trace's env, so the probe's result needs cleaning
        // as well as the commands trace spawns directly.
        let mut env = unix::login_shell_env("/bin/bash");
        if in_appimage() {
            let appdir = env.get("APPDIR").cloned();
            for key in APPIMAGE_ENV {
                env.remove(key);
            }
            if let (Some(path), Some(appdir)) = (env.get("PATH").cloned(), appdir) {
                env.insert("PATH".to_string(), path_without(&path, &appdir));
            }
        }
        env
    }

    fn extra_path_dirs(home: &Path) -> Vec<PathBuf> {
        vec![
            home.join(".local/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/snap/bin"),
        ]
    }

    fn default_shell() -> String {
        unix::default_shell("/bin/bash")
    }

    fn shell_line(line: &str) -> Command {
        unix::shell_line(line)
    }
}

impl SoundPlayer for Os {
    /// The freedesktop sound theme is on most desktops, and `~/.local/share/sounds`
    /// is its per-user home.
    fn sound_folders(home: &Path) -> Vec<SoundFolder> {
        vec![
            SoundFolder {
                path: PathBuf::from("/usr/share/sounds/freedesktop/stereo"),
                source: "system",
            },
            SoundFolder {
                path: home.join(".local/share/sounds"),
                source: "you",
            },
        ]
    }

    /// What PulseAudio and PipeWire's players read. `aplay` only manages wav.
    fn audio_extensions() -> &'static [&'static str] {
        &["wav", "ogg", "oga", "flac"]
    }

    fn play(path: &Path) -> io::Result<Child> {
        unix::play_with(&["paplay", "pw-play", "aplay"], path)
    }
}

/// `systemd-inhibit`'s arguments for a hold while process `pid` (trace) lives.
///
/// `--what=idle` stops the machine idling into sleep and nothing more: a suspend
/// the user asks for (the lid, the menu) still happens, as with macOS's
/// `caffeinate -i`. What runs under the lock is `tail --pid=<trace> -f
/// /dev/null`, which ends by itself once trace is gone, so a killed trace leaves
/// nothing behind (a `sleep infinity` would outlive it, orphaned).
fn inhibit_args(pid: u32) -> Vec<String> {
    let pid = format!("--pid={pid}");
    let args = [
        "--what=idle",
        "--who=trace",
        "--why=Agents are running",
        "tail",
        pid.as_str(),
        "-f",
        "/dev/null",
    ];
    args.iter().map(|a| a.to_string()).collect()
}

impl SleepInhibitor for Os {
    /// A `systemd-inhibit` idle lock for as long as trace runs ([`inhibit_args`]).
    /// Without systemd the spawn fails and nothing is held. If trace is killed,
    /// the kernel kills the inhibitor (`PR_SET_PDEATHSIG`), which drops the lock,
    /// and its `tail` notices trace is gone and ends too.
    fn hold() -> Option<SleepHold> {
        use std::os::unix::process::CommandExt;
        let mut command = super::process::command("systemd-inhibit");
        command.args(inhibit_args(std::process::id()));
        // SAFETY: only an async-signal-safe `prctl` runs between fork and exec.
        unsafe {
            command.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as libc::c_ulong);
                Ok(())
            });
        }
        unix::hold_with(command)
    }
}

impl EditorLauncher for Os {
    fn launchers(editor: Editor) -> Vec<Launcher> {
        match editor {
            Editor::VsCode => vec![("code", &[]), ("code-insiders", &[])],
            Editor::IntelliJ => vec![("idea", &[]), ("intellij-idea-ultimate", &[])],
            Editor::Cursor => vec![("cursor", &[])],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{inhibit_args, path_without};

    #[test]
    fn the_inhibitor_holds_idle_sleep_only_and_ends_with_trace() {
        let args = inhibit_args(4242);
        assert_eq!(
            args[0], "--what=idle",
            "a suspend the user asks for still happens"
        );
        assert_eq!(args[3..], ["tail", "--pid=4242", "-f", "/dev/null"]);
    }

    #[test]
    fn appimage_dirs_leave_path() {
        assert_eq!(
            path_without("/tmp/.mount_x/usr/bin:/usr/bin:/bin", "/tmp/.mount_x"),
            "/usr/bin:/bin"
        );
    }
}
