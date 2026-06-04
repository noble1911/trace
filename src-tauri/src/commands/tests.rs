//! Test runner — runs the issue worktree's test command and reports the result
//! onto the design's `.test-suite` / `.tests-summary` view. Detection is
//! best-effort across common toolchains; the suite-level pass/fail is the
//! process exit code (per-test parsing is framework-specific and out of scope).

use std::path::Path;
use std::process::Command;
use std::time::Instant;

use serde::Serialize;
use tauri::State;

use crate::helpers::slugify;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    /// Human-readable command we ran, e.g. "cargo test".
    pub command: String,
    pub passed: bool,
    pub exit_code: i32,
    pub duration_ms: u64,
    /// Combined stdout+stderr, tail-truncated for the detail view.
    pub output: String,
}

/// Pick a test command for the worktree based on the toolchain files present.
/// Returns `(program, args, display)`.
fn detect(dir: &str) -> Option<(&'static str, Vec<&'static str>, &'static str)> {
    let has = |f: &str| Path::new(&format!("{dir}/{f}")).exists();
    if has("gradlew") {
        return Some(("./gradlew", vec!["test", "--console=plain"], "./gradlew test"));
    }
    if has("Cargo.toml") {
        return Some(("cargo", vec!["test"], "cargo test"));
    }
    if has("pom.xml") {
        return Some(("mvn", vec!["test", "-q"], "mvn test"));
    }
    if has("go.mod") {
        return Some(("go", vec!["test", "./..."], "go test ./..."));
    }
    if has("package.json") {
        // Only if a real test script is defined (skip the npm-init default).
        if let Ok(pkg) = std::fs::read_to_string(format!("{dir}/package.json")) {
            if pkg.contains("\"test\"") && !pkg.contains("no test specified") {
                return Some(("npm", vec!["test", "--silent"], "npm test"));
            }
        }
    }
    if has("pyproject.toml") || has("pytest.ini") || has("setup.py") {
        return Some(("pytest", vec!["-q"], "pytest -q"));
    }
    None
}

/// Tail-truncate combined output so the payload stays small for the UI.
fn tail(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let start = s.len() - max;
    format!("…\n{}", &s[start..])
}

/// Run the worktree's tests and return a single suite-level result.
#[tauri::command]
pub fn run_tests(state: State<'_, AppState>, issue_key: String) -> Result<TestRun, String> {
    let repo = state
        .repo_path
        .read()
        .clone()
        .ok_or_else(|| "Choose a repository folder in Settings first.".to_string())?;
    let worktree = format!("{repo}/.worktrees/{}", slugify(&issue_key));
    if !Path::new(&worktree).exists() {
        return Err(format!("No worktree for {issue_key} — start a session on this issue first."));
    }

    let (program, args, display) = detect(&worktree).ok_or_else(|| {
        "No test command detected (looked for gradlew, Cargo.toml, pom.xml, go.mod, \
         package.json, pytest)."
            .to_string()
    })?;

    let started = Instant::now();
    let out = Command::new(program)
        .args(&args)
        .current_dir(&worktree)
        .output()
        .map_err(|e| format!("Failed to run {display}: {e}"))?;
    let duration_ms = started.elapsed().as_millis() as u64;

    let mut combined = String::from_utf8_lossy(&out.stdout).into_owned();
    combined.push_str(&String::from_utf8_lossy(&out.stderr));

    Ok(TestRun {
        command: display.to_string(),
        passed: out.status.success(),
        exit_code: out.status.code().unwrap_or(-1),
        duration_ms,
        output: tail(combined.trim(), 16_000),
    })
}
