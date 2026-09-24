//! Running `gh` as whichever signed-in account can see the repo.
//!
//! `gh` acts as its *active* account, and people with a work and a personal
//! account switch between them (e.g. to publish a release) — after which every
//! work repo answers "Could not resolve to a Repository". Rather than depend on
//! which account happens to be active, a call that can't see its repo is retried
//! as each other signed-in account (`GH_TOKEN` from `gh auth token --user`), and
//! the account that worked is remembered per repo owner so later polls go
//! straight to it. Tokens only ever pass from `gh` to a child's env — never
//! logged, returned or stored.

use std::collections::HashMap;
use std::process::{Command, Output};
use std::sync::Mutex;

use serde_json::Value;

/// Repo owner → login that last succeeded for it.
static ACCOUNT_FOR_OWNER: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// The failures that mean "this account can't see that repo", as opposed to a
/// real error that another account wouldn't fix.
fn is_not_visible(stderr: &str) -> bool {
    stderr.contains("Could not resolve to a Repository")
        || stderr.contains("HTTP 404")
        || stderr.contains("Not Found")
}

fn remembered(owner: &str) -> Option<String> {
    let guard = ACCOUNT_FOR_OWNER.lock().unwrap_or_else(|p| p.into_inner());
    guard.as_ref()?.get(owner).cloned()
}

fn remember(owner: &str, login: &str) {
    let mut guard = ACCOUNT_FOR_OWNER.lock().unwrap_or_else(|p| p.into_inner());
    guard
        .get_or_insert_with(HashMap::new)
        .insert(owner.to_string(), login.to_string());
}

/// Signed-in github.com logins, the active one first.
fn logins() -> Vec<String> {
    let Ok(out) = Command::new("gh")
        .args(["auth", "status", "--json", "hosts"])
        .output()
    else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_slice::<Value>(&out.stdout) else {
        return Vec::new();
    };
    let mut accounts: Vec<(bool, String)> = v
        .pointer("/hosts/github.com")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|a| a.get("state").and_then(Value::as_str) == Some("success"))
        .filter_map(|a| {
            let login = a.get("login").and_then(Value::as_str)?.to_string();
            let active = a.get("active").and_then(Value::as_bool).unwrap_or(false);
            Some((active, login))
        })
        .collect();
    accounts.sort_by_key(|(active, _)| !active);
    accounts.into_iter().map(|(_, login)| login).collect()
}

fn token_for(login: &str) -> Option<String> {
    let out = Command::new("gh")
        .args(["auth", "token", "--user", login])
        .output()
        .ok()?;
    let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !token.is_empty()).then_some(token)
}

/// `gh args` in `cwd`, as `login` (or the active account when `None`).
fn run_as(cwd: &str, args: &[String], login: Option<&str>) -> Result<Output, String> {
    let mut cmd = Command::new("gh");
    cmd.args(args).current_dir(cwd);
    if let Some(login) = login {
        let token = token_for(login).ok_or_else(|| format!("no gh token for {login}"))?;
        cmd.env("GH_TOKEN", token);
    }
    cmd.output().map_err(|e| format!("gh failed to start: {e}"))
}

/// Run `gh args` in `cwd` against a repo owned by `owner`, falling back through
/// the signed-in accounts until one can see it. Returns stdout, or the first
/// error when none can.
pub fn run(cwd: &str, owner: &str, args: &[String]) -> Result<Vec<u8>, String> {
    // The remembered account, then the active one (`None` = no env override),
    // then — only reached if those can't see the repo — every other account.
    // `logins()` lists the active account first, and it was already tried.
    let candidates = remembered(owner)
        .map(Some)
        .into_iter()
        .chain(std::iter::once(None))
        .chain(std::iter::once_with(|| logins().into_iter().skip(1).map(Some)).flatten());
    let mut tried: Vec<Option<String>> = Vec::new();
    let mut first_err: Option<String> = None;
    for login in candidates {
        if tried.contains(&login) {
            continue;
        }
        tried.push(login.clone());
        let out = match run_as(cwd, args, login.as_deref()) {
            Ok(out) => out,
            Err(e) => {
                first_err.get_or_insert(e);
                continue;
            }
        };
        if out.status.success() {
            if let Some(login) = login {
                remember(owner, &login);
            }
            return Ok(out.stdout);
        }
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if !is_not_visible(&stderr) {
            return Err(stderr);
        }
        first_err.get_or_insert(stderr);
    }
    Err(first_err.unwrap_or_else(|| "gh failed".to_string()))
}

#[cfg(test)]
mod tests {
    use super::is_not_visible;

    #[test]
    fn tells_a_hidden_repo_from_a_real_failure() {
        assert!(is_not_visible(
            "gh: Could not resolve to a Repository with the name 'acme/web'."
        ));
        assert!(is_not_visible(
            "HTTP 404: Not Found (https://api.github.com/…)"
        ));
        assert!(!is_not_visible("HTTP 401: Bad credentials"));
        assert!(!is_not_visible("error connecting to api.github.com"));
    }
}
