//! Claude Code's `claude plugin` CLI: what's installed, and installing, updating
//! and removing a marketplace's plugins (`docs/SKILLS_PLAN.md`, stage 2). Claude
//! Code does the work because it is what loads plugins: files trace copied in
//! itself could drift from how it reads them, and a skill would silently not load.
//!
//! Arguments are built and `--json` answers read here, as pure functions tested on
//! output recorded from Claude Code 2.1; [`run`] is the one place that spawns it.
//! Never `-y`: that accepts whatever command a marketplace declares to fetch a
//! plugin, which is a person's call. Without it such an install fails and says why.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Where an install applies, in Claude Code's words.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// Every project, this person only (`~/.claude/settings.json`).
    User,
    /// Everyone on a project: its committed `.claude/settings.json`.
    Project,
    /// This person on a project: its uncommitted `.claude/settings.local.json`.
    Local,
    /// Set by an administrator (`managed`), or one a newer Claude Code adds.
    #[serde(other)]
    Other,
}

impl Scope {
    /// The `--scope` value; `None` for one trace never installs into.
    fn arg(self) -> Option<&'static str> {
        match self {
            Scope::User => Some("user"),
            Scope::Project => Some("project"),
            Scope::Local => Some("local"),
            Scope::Other => None,
        }
    }
}

/// One install, as `claude plugin list --json` reports it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    /// `<plugin>@<marketplace>`.
    pub id: String,
    pub version: Option<String>,
    pub scope: Scope,
    #[serde(default)]
    pub enabled: bool,
    /// A project or local install's project, as Claude Code resolved it (a real
    /// path: `/private/tmp/…` for `/tmp/…` on macOS).
    pub project_path: Option<String>,
}

/// Whether `s` can be a plugin or marketplace name on a command line: no flag
/// look-alikes, no paths, nothing a shell or Claude Code would read as more.
pub fn is_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && !s.starts_with(['-', '.'])
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// `<plugin>@<marketplace>`, both checked.
pub fn plugin_id(plugin: &str, marketplace: &str) -> Result<String, String> {
    if !is_name(plugin) || !is_name(marketplace) {
        return Err(format!(
            "\"{plugin}@{marketplace}\" isn't a plugin trace can install."
        ));
    }
    Ok(format!("{plugin}@{marketplace}"))
}

fn split_id(id: &str) -> Result<(&str, &str), String> {
    id.split_once('@')
        .filter(|(p, m)| is_name(p) && is_name(m))
        .ok_or_else(|| format!("\"{id}\" isn't a plugin id."))
}

fn scope_arg(scope: Scope) -> Result<&'static str, String> {
    scope.arg().ok_or_else(|| {
        "trace only installs for you, for a project, or for you on a project.".into()
    })
}

fn owned(args: &[&str]) -> Vec<String> {
    args.iter().map(|a| a.to_string()).collect()
}

/// `claude plugin list --json`.
pub fn list_args() -> Vec<String> {
    owned(&["plugin", "list", "--json"])
}

/// Install `plugin` (a bare name) from the marketplace in GitHub repo `source`
/// (`owner/name`). Claude Code adds the marketplace first if it hasn't yet.
pub fn install_args(plugin: &str, source: &str, scope: Scope) -> Result<Vec<String>, String> {
    if !is_name(plugin) {
        return Err(format!("\"{plugin}\" isn't a plugin name."));
    }
    let s = scope_arg(scope)?;
    Ok(owned(&[
        "plugin",
        "install",
        plugin,
        "--marketplace",
        source,
        "--scope",
        s,
        "--json",
    ]))
}

/// Remove plugin `id` from `scope`.
pub fn uninstall_args(id: &str, scope: Scope) -> Result<Vec<String>, String> {
    split_id(id)?;
    let s = scope_arg(scope)?;
    Ok(owned(&["plugin", "uninstall", id, "--scope", s, "--json"]))
}

/// Re-read plugin `id`'s marketplace, then update it in `scope`: both steps, as
/// `plugin update` only looks at Claude Code's last copy of the marketplace.
pub fn update_args(id: &str, scope: Scope) -> Result<[Vec<String>; 2], String> {
    let (_, marketplace) = split_id(id)?;
    let s = scope_arg(scope)?;
    Ok([
        owned(&["plugin", "marketplace", "update", marketplace, "--json"]),
        owned(&["plugin", "update", id, "--scope", s, "--json"]),
    ])
}

/// The installs in `plugin list --json`'s output. One entry it can't read (a
/// field a newer Claude Code changed) is skipped rather than failing them all.
pub fn parse_list(stdout: &str) -> Result<Vec<Installed>, String> {
    let all: Vec<Value> = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Couldn't read Claude Code's plugin list: {e}"))?;
    Ok(all
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect())
}

/// What a `--json` install, update or uninstall said: `Ok(message)` when it
/// worked, else why not. Its answer is the last JSON line with an `outcome`.
pub fn parse_outcome(stdout: &str, stderr: &str) -> Result<String, String> {
    let answer = stdout
        .lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
        .find(|v| v.get("outcome").is_some());
    let message = |v: &Value| v["message"].as_str().map(str::to_string);
    match answer {
        Some(v) if v["outcome"] == "ok" => Ok(message(&v).unwrap_or_default()),
        Some(v) => Err(message(&v).unwrap_or_else(|| "Claude Code couldn't do it.".into())),
        None => Err(crate::helpers::tail_chars(
            stderr.trim().trim_start_matches('✘').trim(),
            600,
        )),
    }
}

/// One `claude plugin` at a time: two at once would both rewrite Claude Code's
/// record of what's installed.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// Run `claude <args>` in `cwd` (a project's root for its scopes) and return its
/// stdout and stderr. Blocking: call it off the main thread.
pub fn run(args: &[String], cwd: &Path) -> Result<(bool, String, String), String> {
    let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|p| p.into_inner());
    let mut cmd = crate::claude::discovery::command("claude");
    cmd.args(args)
        .current_dir(cwd)
        .envs(crate::claude::env::build_effective_cli_env(&HashMap::new()))
        // A private marketplace's clone must fail, not wait on a prompt nobody sees.
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null());
    // A trace started from a Claude session would otherwise act as that session.
    for key in crate::claude::env::INHERITED_SESSION_ENV {
        cmd.env_remove(key);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("Couldn't run Claude Code: {e}"))?;
    Ok((
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    ))
}

#[cfg(test)]
#[path = "cli_tests.rs"]
mod tests;
