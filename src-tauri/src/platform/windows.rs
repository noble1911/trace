//! The Windows adapter. Agents run natively, with Git Bash behind Claude's hooks and
//! Bash tool, which is why trace's relay scripts stay bash here too.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

use super::ports::{
    AgentBridge, AgentEnvironment, Editor, EditorLauncher, Launcher, PrivateFiles, ProcessGroup,
    ProcessHost, SoundFolder, SoundPlayer, ToolLocator,
};
use super::{process, windows_job, Os};

/// Stops a GUI app's child from opening a console window for each command.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

impl ProcessHost for Os {
    fn prepare(command: &mut Command) {
        command.creation_flags(CREATE_NO_WINDOW);
        // A worktree nests its repo a level deeper, and `node_modules` can then pass the
        // 260-character limit git otherwise keeps to here. Only git reads these.
        command
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "core.longpaths")
            .env("GIT_CONFIG_VALUE_0", "true");
    }

    fn is_alive(pid: u32) -> bool {
        // SAFETY: the handle is checked before use and closed on every path.
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut code = 0;
            let ok = GetExitCodeProcess(handle, &mut code) != 0;
            CloseHandle(handle);
            ok && code == STILL_ACTIVE as u32
        }
    }

    fn stop_tree(pid: u32) {
        let _ = process::command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    fn pty_reports_exit() -> bool {
        false
    }

    /// Nothing to set up: [`Self::track_group`] puts the child in a job object.
    fn own_group(_command: &mut Command) {}

    /// A job object holding the child: everything it starts joins the job, and
    /// terminating the job reaches them even after the child has exited (when
    /// `taskkill /T`, which walks parent ids, no longer can). A child could start
    /// something in the instant before it's assigned; `taskkill` covers that one
    /// while the child lives, and is the fallback if the job can't be made.
    fn track_group(child: &Child) -> ProcessGroup {
        let pid = child.id();
        match windows_job::assign(child) {
            Some(job) => ProcessGroup::new(move || {
                job.terminate();
                Self::stop_tree(pid);
            }),
            None => ProcessGroup::new(move || Self::stop_tree(pid)),
        }
    }
}

/// Executable forms of `name`. A bare `name` is left out on purpose: npm puts a Unix
/// shell script called `claude` beside `claude.cmd`, and Windows can't run it.
fn executable_forms(name: &str) -> Vec<String> {
    if Path::new(name).extension().is_some() {
        return vec![name.to_string()];
    }
    ["exe", "cmd", "bat"]
        .iter()
        .map(|ext| format!("{name}.{ext}"))
        .collect()
}

fn in_dirs(dirs: &[PathBuf], name: &str) -> Vec<PathBuf> {
    let forms = executable_forms(name);
    dirs.iter()
        .flat_map(|dir| forms.iter().map(move |form| dir.join(form)))
        .collect()
}

fn env_dir(key: &str, suffix: &str) -> Option<PathBuf> {
    std::env::var_os(key).map(|root| PathBuf::from(root).join(suffix))
}

/// Git and the GitHub CLI's default install folders.
fn program_dirs() -> Vec<PathBuf> {
    [
        env_dir("ProgramFiles", "Git\\cmd"),
        env_dir("ProgramFiles", "GitHub CLI"),
    ]
    .into_iter()
    .flatten()
    .collect()
}

fn user_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![home.join(".local\\bin")];
    dirs.extend(env_dir("APPDATA", "npm"));
    dirs
}

impl ToolLocator for Os {
    fn executable_names(name: &str) -> Vec<String> {
        executable_forms(name)
    }

    fn user_tool_paths(home: &Path, name: &str) -> Vec<PathBuf> {
        in_dirs(&user_dirs(home), name)
    }

    fn system_tool_paths(name: &str) -> Vec<PathBuf> {
        in_dirs(&program_dirs(), name)
    }

    fn project_wrapper(dir: &Path, name: &str) -> PathBuf {
        dir.join(format!("{name}.bat"))
    }

    /// A pseudo console runs executables directly, so a batch file needs help. The
    /// interpreter would split trace's JSON arguments at any `&`, so an npm install runs
    /// the program its shim points at instead. Other batch files have no alternative.
    fn pty_invocation(tool: &str) -> Vec<String> {
        let lower = tool.to_ascii_lowercase();
        if !lower.ends_with(".cmd") && !lower.ends_with(".bat") {
            return vec![tool.to_string()];
        }
        if let Some(argv) = npm_shim_argv(Path::new(tool)) {
            return argv;
        }
        let shell = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
        vec![shell, "/c".to_string(), tool.to_string()]
    }

    /// Never a git built on MSYS2 or Cygwin (devkitPro, a bare MSYS2 install). It writes
    /// paths its own way, like `/home/you/repo` for `C:\Users\you\repo`, into a worktree's
    /// `.git` file, which Git for Windows, editors and `gh` then can't follow. Only git:
    /// Git Bash, which trace's hooks need, is an MSYS2 build itself.
    fn is_usable(name: &str, path: &Path) -> bool {
        name != "git" || !is_posix_runtime_build(path)
    }
}

/// Whether `exe` is built on a POSIX emulation layer: those ship its runtime beside them.
fn is_posix_runtime_build(exe: &Path) -> bool {
    exe.parent().is_some_and(|dir| {
        ["msys-2.0.dll", "cygwin1.dll"]
            .iter()
            .any(|runtime| dir.join(runtime).is_file())
    })
}

/// The program in an npm shim's last line, relative to the shim:
/// `... "%_prog%"  "%dp0%\\node_modules\\pkg\\cli.js" %*`.
fn npm_shim_target(shim: &str) -> Option<String> {
    let target = regex::Regex::new(r#""%dp0%\\([^"]+)"\s+%\*"#).ok()?;
    Some(target.captures(shim)?[1].to_string())
}

/// How to run what an npm shim runs, without the shim.
fn npm_shim_argv(shim_path: &Path) -> Option<Vec<String>> {
    let dir = shim_path.parent()?;
    let target = dir.join(npm_shim_target(&fs::read_to_string(shim_path).ok()?)?);
    if !target.is_file() {
        return None;
    }
    let program = target.to_string_lossy().to_string();
    let is_script = target.extension().is_some_and(|ext| {
        ["js", "cjs", "mjs"]
            .iter()
            .any(|js| ext.eq_ignore_ascii_case(js))
    });
    if !is_script {
        return Some(vec![program]);
    }
    // The shim prefers a node.exe installed beside it, as a global npm install has.
    let local_node = dir.join("node.exe");
    let node = if local_node.is_file() {
        local_node.to_string_lossy().to_string()
    } else {
        "node".to_string()
    };
    Some(vec![node, program])
}

/// Windows variable names ignore case and `PATH` usually arrives as `Path`, which
/// would otherwise leave two competing entries once trace adds to it.
fn with_upper_path(vars: impl Iterator<Item = (String, String)>) -> HashMap<String, String> {
    vars.map(|(key, value)| {
        if key.eq_ignore_ascii_case("PATH") {
            ("PATH".to_string(), value)
        } else {
            (key, value)
        }
    })
    .collect()
}

impl AgentEnvironment for Os {
    /// There's no login shell to ask: a Windows app already inherits the user's env.
    fn capture_env() -> HashMap<String, String> {
        with_upper_path(std::env::vars())
    }

    fn extra_path_dirs(home: &Path) -> Vec<PathBuf> {
        let mut dirs = user_dirs(home);
        dirs.extend(program_dirs());
        dirs
    }

    /// PowerShell, the shell Windows itself now opens: 7 (`pwsh`) where it's installed,
    /// else the 5.1 every Windows has, and `cmd.exe` only if neither can be found.
    fn default_shell() -> String {
        let on_path = std::env::var_os("PATH")
            .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
            .unwrap_or_default()
            .into_iter()
            .map(|dir| dir.join("pwsh.exe"));
        let candidates = on_path
            .chain(env_dir("ProgramFiles", "PowerShell\\7\\pwsh.exe"))
            .chain(env_dir(
                "SystemRoot",
                "System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            ));
        candidates
            .into_iter()
            .find(|shell| shell.is_file())
            .map(|shell| shell.to_string_lossy().into_owned())
            .or_else(|| std::env::var("ComSpec").ok())
            .unwrap_or_else(|| "cmd.exe".to_string())
    }

    /// `cmd /D /S /C "<line>"`, as npm runs package scripts. With `/S` cmd strips the
    /// outer quotes and runs the rest verbatim, so the line goes in raw: Rust's own
    /// argument quoting is for the MSVC parser and would mangle quotes inside it.
    fn shell_line(line: &str) -> Command {
        let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
        let mut command = process::command(comspec);
        command.raw_arg(format!("/D /S /C \"{line}\""));
        command
    }
}

impl AgentBridge for Os {
    fn install_script(path: &Path, body: &str) -> io::Result<()> {
        fs::write(path, body)
    }

    /// Git Bash reads `C:/Users/...`, where backslashes would be escapes.
    fn shell_path(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }
}

impl PrivateFiles for Os {
    /// Files inherit the user-only ACL `restrict_dir` puts on the config dir.
    fn owner_only_options() -> OpenOptions {
        OpenOptions::new()
    }

    fn restrict_file(_path: &Path) {}

    /// Logged rather than returned: a failure mustn't stop trace from opening, but it
    /// leaves credentials readable by whatever the folder inherits.
    fn restrict_dir(path: &Path) {
        if let Err(reason) = restrict_acl(path) {
            tracing::warn!("couldn't restrict the config dir's ACL: {reason}");
        }
    }
}

impl SoundPlayer for Os {
    fn sound_folders(_home: &Path) -> Vec<SoundFolder> {
        env_dir("WINDIR", "Media")
            .into_iter()
            .map(|path| SoundFolder {
                path,
                source: "system",
            })
            .collect()
    }

    /// All .NET's built-in player reads.
    fn audio_extensions() -> &'static [&'static str] {
        &["wav"]
    }

    /// The path travels by env var, so it can't be read as PowerShell code.
    fn play(path: &Path) -> io::Result<Child> {
        process::command("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(New-Object Media.SoundPlayer $env:TRACE_SOUND).PlaySync()",
            ])
            .env("TRACE_SOUND", path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    }
}

impl EditorLauncher for Os {
    fn launchers(editor: Editor) -> Vec<Launcher> {
        match editor {
            Editor::VsCode => vec![("code", &[]), ("code-insiders", &[])],
            Editor::IntelliJ => vec![("idea", &[]), ("idea64.exe", &[])],
            Editor::Cursor => vec![("cursor", &[])],
        }
    }
}

impl super::ports::AppViewLayout for Os {
    /// A child WebView2 controller, sized only by the bounds Tauri sets.
    fn sized_by_bounds() -> bool {
        true
    }
}

#[path = "windows_acl.rs"]
mod config_acl;
use config_acl::restrict_acl;
#[cfg(test)]
use config_acl::{icacls, is_restricted, parse_sid};

#[cfg(test)]
#[path = "windows_git_tests.rs"]
mod git_tests;
#[cfg(test)]
#[path = "windows_tests.rs"]
mod tests;
