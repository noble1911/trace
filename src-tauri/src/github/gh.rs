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
use std::process::Output;
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

/// One github.com account from `gh auth status --json hosts`.
#[derive(Debug, PartialEq)]
pub(crate) struct Account {
    pub login: String,
    pub active: bool,
    pub ok: bool,
}

/// The github.com accounts in `gh auth status --json hosts` output.
pub(crate) fn parse_auth_status(json: &str) -> Result<Vec<Account>, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("Unexpected gh output: {e}"))?;
    Ok(v.pointer("/hosts/github.com")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|a| {
            Some(Account {
                login: a.get("login").and_then(Value::as_str)?.to_string(),
                active: a.get("active").and_then(Value::as_bool).unwrap_or(false),
                ok: a.get("state").and_then(Value::as_str) == Some("success"),
            })
        })
        .collect())
}

/// Signed-in github.com logins, the active one first.
pub(super) fn logins() -> Vec<String> {
    let Ok(out) = crate::claude::discovery::command("gh")
        .args(["auth", "status", "--json", "hosts"])
        .output()
    else {
        return Vec::new();
    };
    let Ok(mut accounts) = parse_auth_status(&String::from_utf8_lossy(&out.stdout)) else {
        return Vec::new();
    };
    accounts.retain(|a| a.ok);
    accounts.sort_by_key(|a| !a.active);
    accounts.into_iter().map(|a| a.login).collect()
}

pub(super) fn token_for(login: &str) -> Option<String> {
    let out = crate::claude::discovery::command("gh")
        .args(["auth", "token", "--user", login])
        .output()
        .ok()?;
    let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !token.is_empty()).then_some(token)
}

/// `gh args` in `cwd`, as `login` (or the active account when `None`).
fn run_as(cwd: &str, args: &[String], login: Option<&str>) -> Result<Output, String> {
    let mut cmd = crate::claude::discovery::command("gh");
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
    run_with(cwd, owner, args, false)
}

/// Like [`run`], for `gh api graphql`: GitHub answers a query that is partly
/// unresolvable (one PR of fifty deleted) with the rest of its `data` *and* an
/// error, which `gh` turns into a failed exit with that answer still on stdout.
/// This keeps the answer; the caller reads what's there.
pub fn run_partial(cwd: &str, owner: &str, args: &[String]) -> Result<Vec<u8>, String> {
    run_with(cwd, owner, args, true)
}

fn run_with(
    cwd: &str,
    owner: &str,
    args: &[String],
    keep_partial: bool,
) -> Result<Vec<u8>, String> {
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
            if keep_partial && !out.stdout.is_empty() {
                if let Some(login) = login {
                    remember(owner, &login);
                }
                return Ok(out.stdout);
            }
            return Err(stderr);
        }
        first_err.get_or_insert(stderr);
    }
    Err(first_err.unwrap_or_else(|| "gh failed".to_string()))
}

#[cfg(test)]
mod tests {
    use super::{is_not_visible, parse_auth_status};

    #[test]
    fn parses_gh_auth_status() {
        let json = r#"{"hosts":{"github.com":[
            {"state":"success","active":false,"login":"work"},
            {"state":"error","active":true,"login":"me"}
        ],"ghe.corp":[{"state":"success","active":true,"login":"corp"}]}}"#;
        let accounts = parse_auth_status(json).unwrap();
        assert_eq!(accounts.len(), 2, "other hosts ignored");
        assert!(accounts[0].ok && !accounts[1].ok && accounts[1].active);
        assert!(parse_auth_status("unknown flag: --json").is_err());
    }

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
