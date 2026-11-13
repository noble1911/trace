//! Which tickets' agents run in a cloud sandbox. A session carries its host on
//! its own record (`ScratchSession.host`); a ticket has no record of its own, so
//! its host is kept here, by issue key, in `issue-hosts.json`. A key with no entry
//! runs on this machine, in a worktree, as it always did.

use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::commands::session::owning_session;
use crate::execution::SessionHost;
use crate::helpers::persist::{self, Style};

fn file() -> PathBuf {
    crate::helpers::trace_dir().join("issue-hosts.json")
}

type Hosts = BTreeMap<String, SessionHost>;

/// The sandbox `issue_key`'s agent runs in, if it runs in one.
pub(crate) fn of_issue(issue_key: &str) -> Option<SessionHost> {
    persist::read_or_log::<Hosts>(&file()).remove(issue_key)
}

/// The sandbox `workspace_id`'s agent runs in: its session's, or its ticket's.
/// None when it runs on this machine.
pub(crate) fn host_of(workspace_id: &str) -> Option<SessionHost> {
    match owning_session(workspace_id) {
        Some(session) => session.host,
        None => of_issue(workspace_id),
    }
}

/// The sandbox a ticket's agent runs in, for its detail view; None on this machine.
#[tauri::command]
pub fn issue_host(issue_key: String) -> Option<SessionHost> {
    of_issue(&issue_key)
}

fn save(issue_key: &str, host: Option<SessionHost>) -> Result<(), String> {
    persist::update(&file(), Style::Compact, |hosts: &mut Hosts| match host {
        Some(h) => {
            hosts.insert(issue_key.to_string(), h);
        }
        None => {
            hosts.remove(issue_key);
        }
    })
}

/// Settle where `issue_key`'s agent runs for this start and remember it. `choice` is
/// the renderer's pick ("local" | "vercel"); `None` keeps what the ticket had. A
/// sandbox needs the ticket's repo to have a GitHub origin (`session_host::new_host`).
/// Returns the host when it's a sandbox.
pub(crate) fn settle(
    issue_key: &str,
    match_text: &str,
    choice: Option<&str>,
) -> Result<Option<SessionHost>, String> {
    let host = match choice {
        None | Some("") => return Ok(of_issue(issue_key)),
        Some("local") => None,
        Some(other) => {
            let repo = crate::commands::repos::repo_for_matching(issue_key, match_text)?;
            let id = crate::helpers::slugify(issue_key);
            let fresh = crate::commands::session_host::new_host(Some(other), &id, Some(&repo))?;
            // Keep a sandbox the ticket already has: its snapshot and branch live there.
            match (of_issue(issue_key), fresh) {
                (Some(old), Some(new)) if same_repo(&old, &new) => Some(old),
                (_, new) => new,
            }
        }
    };
    save(issue_key, host.clone())?;
    Ok(host)
}

fn same_repo(a: &SessionHost, b: &SessionHost) -> bool {
    let (SessionHost::Vercel { remote: x, .. }, SessionHost::Vercel { remote: y, .. }) = (a, b)
    else {
        return false;
    };
    x == y
}

/// Refuse what only works on a checkout on this machine, for a ticket in a sandbox.
pub(crate) fn require_local(issue_key: &str, what: &str) -> Result<(), String> {
    match of_issue(issue_key) {
        Some(_) => Err(format!(
            "{what} isn't available while {issue_key} runs in a cloud sandbox."
        )),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vercel(remote: &str) -> SessionHost {
        SessionHost::Vercel {
            sandbox: "trace-x".into(),
            remote: Some(remote.into()),
        }
    }

    #[test]
    fn a_new_sandbox_for_the_same_repo_keeps_the_old_one() {
        assert!(same_repo(&vercel("a/b"), &vercel("a/b")));
        assert!(!same_repo(&vercel("a/b"), &vercel("a/c")));
    }
}
