//! What trace needs from the operating system, one trait per concern. Domain code
//! depends on these; `macos`, `linux` and `windows` implement them for [`super::Os`].
//!
//! Methods are associated functions because exactly one adapter is compiled into a
//! build: there is no state to hold and nothing to choose at runtime. Domain logic
//! that wants testing against a fake takes the port as a type parameter.

use std::fs::OpenOptions;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

use std::collections::HashMap;
use std::sync::mpsc::Receiver;

/// Starting and stopping processes.
pub trait ProcessHost {
    /// Applied to every process trace spawns: a GUI app's children mustn't flash a
    /// console on Windows, or inherit an AppImage's private libraries on Linux.
    fn prepare(command: &mut Command);

    /// Whether `pid` is still running. Decides if a ledger entry belongs to another
    /// running trace, so a wrong "alive" hides an interrupted agent.
    fn is_alive(pid: u32) -> bool;

    /// Stop what an agent started as well as the agent. A Unix PTY hangs up its whole
    /// session when it closes, but a Windows pseudo console leaves descendants running.
    fn stop_tree(pid: u32);

    /// Whether a PTY's reader sees EOF when its process exits. A pseudo console stays
    /// open until it's closed, so on Windows trace has to watch the process itself.
    fn pty_reports_exit() -> bool;

    /// Set `command` up so [`Self::track_group`] can reach everything it starts:
    /// stopping `sh -c` alone would leave its `curl` running.
    fn own_group(command: &mut Command);

    /// Right after spawning a command set up with [`Self::own_group`]: a handle
    /// that stops the child and everything it started — even once the child has
    /// exited and left a background process behind.
    fn track_group(child: &Child) -> ProcessGroup;
}

/// A spawned process's whole tree, stoppable at once ([`ProcessHost::track_group`]).
/// Dropping it doesn't stop anything.
pub struct ProcessGroup {
    stop: Box<dyn FnMut() + Send>,
}

impl ProcessGroup {
    /// A group stopped by `stop` (which owns whatever it needs to release).
    pub fn new(stop: impl FnMut() + Send + 'static) -> Self {
        Self {
            stop: Box::new(stop),
        }
    }

    /// Kill every process in the group. Safe to call more than once.
    pub fn stop(&mut self) {
        (self.stop)();
    }
}

/// Finding the CLIs trace runs (`claude`, `codex`, `git`, `gh`, …).
pub trait ToolLocator {
    /// File names that count as `name` when searching a directory.
    fn executable_names(name: &str) -> Vec<String>;

    /// Per-user install locations, checked before `PATH`.
    fn user_tool_paths(home: &Path, name: &str) -> Vec<PathBuf>;

    /// System install locations, checked after `PATH`: a GUI app can start with a
    /// `PATH` that's missing them.
    fn system_tool_paths(name: &str) -> Vec<PathBuf>;

    /// A project's own wrapper script, such as `gradlew`.
    fn project_wrapper(dir: &Path, name: &str) -> PathBuf;

    /// The program and leading arguments that run `tool` inside a PTY.
    fn pty_invocation(tool: &str) -> Vec<String>;

    /// Whether a binary found for `name` is one trace can use. An adapter can pass over
    /// a build that behaves differently, and the search carries on to the next match.
    fn is_usable(_name: &str, _path: &Path) -> bool {
        true
    }
}

/// The environment and shell agents run in.
pub trait AgentEnvironment {
    /// The variables an agent should start from: what the user sees in a terminal.
    fn capture_env() -> HashMap<String, String>;

    /// Directories added to `PATH`, so common install locations resolve.
    fn extra_path_dirs(home: &Path) -> Vec<PathBuf>;

    /// The shell behind the plain Terminal tab.
    fn default_shell() -> String;

    /// A command running `line` through the platform's plain command shell
    /// (`sh -c`, `cmd /C`) — how a repo's setup commands run in a new worktree.
    fn shell_line(line: &str) -> Command;
}

/// The scripts agents use to reach trace (`trace-hook`, `trace-render`).
pub trait AgentBridge {
    /// Write a bash script where agents can run it.
    fn install_script(path: &Path, body: &str) -> io::Result<()>;

    /// `path` as the shell that runs Claude's hooks expects to read it.
    fn shell_path(path: &Path) -> String;
}

/// Keeping trace's state files, which include credentials, to the current user.
pub trait PrivateFiles {
    /// Options that create a file user-only from its first instant, where the OS can.
    fn owner_only_options() -> OpenOptions;

    /// Make an existing file user-only.
    fn restrict_file(path: &Path);

    /// Make a directory, and everything in it, user-only. Run once at startup.
    fn restrict_dir(path: &Path);
}

/// A folder of notification sounds to offer.
pub struct SoundFolder {
    pub path: PathBuf,
    /// "system" or "you": where the sounds came from.
    pub source: &'static str,
}

/// Notification sounds.
pub trait SoundPlayer {
    fn sound_folders(home: &Path) -> Vec<SoundFolder>;

    /// Lowercase extensions the player can handle. Also the guard on a user-picked
    /// file: trace hands the path to a player, so it must be audio and nothing else.
    fn audio_extensions() -> &'static [&'static str];

    /// Start playing `path`. The caller reaps the child and never waits on the sound.
    fn play(path: &Path) -> io::Result<Child>;
}

/// The editors trace can open a workspace in.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Editor {
    VsCode,
    IntelliJ,
    Cursor,
}

/// A program and the arguments placed before the path being opened.
pub type Launcher = (&'static str, &'static [&'static str]);

/// Opening a folder in a desktop editor.
pub trait EditorLauncher {
    /// What to try for `editor`, best first.
    fn launchers(editor: Editor) -> Vec<Launcher>;
}

/// Saving the app's page, with its print styles, as a PDF (the Plan tab's export).
pub trait PdfPrinter {
    /// Whether the webview can write a PDF itself. Where it can't, the renderer opens
    /// the print dialog instead, which offers saving as PDF.
    fn prints_to_pdf() -> bool;

    /// Start printing `webview`'s page to `path`; the receiver gets the outcome.
    fn print_to_pdf(webview: &tauri::Webview, path: &Path) -> Receiver<Result<(), String>>;
}

/// Called once with how a snapshot went.
#[cfg(feature = "recording")]
pub type SnapshotDone = Box<dyn FnOnce(Result<(), String>) + Send + 'static>;

/// A rectangle in points (CSS pixels at zoom 1), origin top-left.
#[cfg(feature = "recording")]
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Snapshots of trace's own webviews, for the homepage clip recorder (`recording`
/// builds only; on Windows it records over WebView2's DevTools protocol instead).
#[cfg(feature = "recording")]
pub trait PageSnapshot {
    /// Render `area` of `webview` (in the view's own coordinates; all of it when
    /// `None`) to a PNG at `path`, then call `done`. Returns at once.
    fn snapshot_png(
        webview: &tauri::Webview,
        path: PathBuf,
        area: Option<Area>,
        done: SnapshotDone,
    ) {
        let _ = (webview, path, area);
        done(Err("Page snapshots are macOS-only.".to_string()));
    }

    /// Where `webview` is in its window's content, or `None` while it's hidden.
    fn frame_in_window(webview: &tauri::Webview) -> Option<Area> {
        let _ = webview;
        None
    }
}

/// An active request to keep the computer awake; releases it when dropped. Make and
/// drop it on the same thread: Windows' request belongs to the thread that made it.
pub struct SleepHold {
    release: Option<Box<dyn FnOnce() + Send>>,
}

impl SleepHold {
    /// A hold that undoes itself by running `release`.
    pub fn new(release: impl FnOnce() + Send + 'static) -> Self {
        Self {
            release: Some(Box::new(release)),
        }
    }
}

impl Drop for SleepHold {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            release();
        }
    }
}

/// Keeping the computer from sleeping on its own while agents work. The display may
/// still sleep: only the system is held.
pub trait SleepInhibitor {
    /// Start holding. `None` when this machine can't be held (no `systemd-inhibit`,
    /// a refused spawn): trace carries on, and the computer sleeps as it always has.
    fn hold() -> Option<SleepHold>;
}
