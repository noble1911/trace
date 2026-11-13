//! Which host a workspace's agent runs on. A session can live in a cloud
//! sandbox (`ScratchSession.host`); everything else runs on this machine. Also
//! makes the session records for a new sandbox session and for one joined from
//! another trace.

use crate::commands::session::{load, update, ScratchSession};
use crate::execution::credential;
use crate::execution::sandbox::host::{SandboxHost, SandboxTarget, Secrets};
use crate::execution::sandbox::SandboxProvider;
use crate::execution::vercel::{auth, Vercel};
use crate::execution::{Capabilities, Host, SessionHost};
use crate::repo_catalog::model::RemoteRepo;

/// The host `workspace_id`'s agent runs on.
pub(crate) fn host_for(workspace_id: &str) -> Result<Host, String> {
    let sessions = load();
    if let Some(s) = sessions.iter().find(|s| s.id == workspace_id) {
        if let Some(host) = &s.host {
            return sandbox_host(&s.id, &s.title, s.repo.as_deref(), host);
        }
    } else if sessions
        .iter()
        .any(|s| s.host.is_some() && s.agents.iter().any(|a| a.id == workspace_id))
    {
        return Err("A sandbox session can't have extra agents yet.".to_string());
    } else if let Some(host) = crate::commands::issue_host::of_issue(workspace_id) {
        // A ticket's sandbox: it names itself and its repo by the issue key.
        let local_repo = crate::commands::repos::repo_for(workspace_id).ok();
        return sandbox_host(workspace_id, workspace_id, local_repo.as_deref(), &host);
    }
    Ok(Host::local())
}

fn sandbox_host(
    id: &str,
    title: &str,
    local_repo: Option<&str>,
    host: &SessionHost,
) -> Result<Host, String> {
    match host {
        SessionHost::Peer {
            peer,
            repo,
            remote_id,
        } => crate::commands::session_peer::host(title, peer, repo, remote_id.as_deref()),
        SessionHost::Vercel { sandbox, remote } => {
            let conn = auth::load().ok_or("Connect Vercel in Integrations first.")?;
            let remote = remote
                .as_deref()
                .and_then(github_remote)
                .ok_or("This session doesn't say which GitHub repository to check out.")?;
            // The repo's setup, found by its local checkout or else its remote.
            let catalog = crate::repo_catalog::store::load();
            let setup = local_repo
                .and_then(|path| catalog.for_path(path))
                .or_else(|| catalog.for_remote(&remote))
                .map(|r| r.setup.clone())
                .unwrap_or_default();
            let target = SandboxTarget {
                workspace_id: id.to_string(),
                sandbox: sandbox.clone(),
                remote,
                title: title.to_string(),
                setup,
            };
            let secrets = Secrets {
                github: None,
                pick_github: Some(github_preferences(local_repo)),
                claude: credential::load(),
            };
            Ok(Host::Vercel(Box::new(SandboxHost::new(
                Vercel::new(conn),
                target,
                secrets,
            ))))
        }
    }
}

/// What `workspace_id`'s agent can do besides its screen: everything on this
/// machine, less on another host. The renderer hides what isn't there (the
/// chat transport, the transcript view, the folder's tabs).
#[tauri::command]
pub fn agent_capabilities(workspace_id: String) -> Capabilities {
    crate::commands::issue_host::host_of(&workspace_id)
        .as_ref()
        .map_or(Capabilities::ALL, SessionHost::capabilities)
}

/// A deleted session's sandbox goes too, snapshot and all, so nothing lingers on
/// the provider. In the background: the session's own thread may still be
/// stopping it, and a running sandbox can't be deleted. Archiving keeps it.
pub(crate) fn forget_remote(session: &ScratchSession) {
    let Some(SessionHost::Vercel { sandbox, .. }) = session.host.clone() else {
        return;
    };
    crate::execution::sandbox::prs::forget(&session.id);
    crate::execution::sandbox::events::forget(&session.id);
    let Some(conn) = auth::load() else {
        return;
    };
    std::thread::spawn(move || {
        let vercel = Vercel::new(conn);
        for _ in 0..20 {
            match vercel.find(&sandbox) {
                Ok(None) => return,
                Ok(Some(info)) if info.is_running() => {
                    if let Some(id) = info.session_id {
                        let _ = vercel.stop(&id);
                    }
                }
                Ok(Some(_)) => {
                    if vercel.remove(&sandbox).is_ok() {
                        return;
                    }
                }
                Err(_) => {}
            }
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    });
}

/// The GitHub accounts to try first for a session's repo: the one set for it in
/// Settings, then the one its SSH alias names. Cheap (local files and `git`),
/// so it runs before the session's thread does the rest (`github::pick`).
fn github_preferences(repo: Option<&str>) -> Vec<(String, &'static str)> {
    let Some(repo) = repo else {
        return Vec::new();
    };
    let set = crate::repo_catalog::github_account_for(repo).map(|l| (l, "set for this repository"));
    let alias = crate::repo_catalog::origin_alias_account(repo).map(|l| (l, "its SSH alias"));
    set.into_iter().chain(alias).collect()
}

/// Where a sandbox session's agent works: its repo folder in the sandbox.
pub(crate) fn sandbox_cwd(host: &SessionHost) -> String {
    match host {
        SessionHost::Vercel { remote, .. } => {
            let name = remote
                .as_deref()
                .and_then(github_remote)
                .map(|r| r.name)
                .unwrap_or_default();
            format!("/vercel/{name}")
        }
        // Its folder is on the peer, which chooses it.
        SessionHost::Peer { .. } => String::new(),
    }
}

/// The PRs of a session in a sandbox: its branch's, on its GitHub repo, since
/// there's no checkout here to ask. None when `workspace_id` isn't one.
pub(crate) fn remote_prs(workspace_id: &str) -> Option<Vec<String>> {
    let id = crate::commands::session::owning_session(workspace_id)
        .map_or_else(|| workspace_id.to_string(), |s| s.id);
    let host = crate::commands::issue_host::host_of(&id)?;
    let SessionHost::Vercel { remote, .. } = &host else {
        return None;
    };
    let remote = remote.as_deref().and_then(github_remote)?;
    let branch = crate::execution::sandbox::host::session_branch(&id);
    // The ones its `gh` reported opening, then its branch's on GitHub.
    let mut prs = crate::execution::sandbox::prs::of(&id);
    for url in crate::github::links::repo_branch_prs(&remote, &branch) {
        if !prs.contains(&url) {
            prs.push(url);
        }
    }
    Some(prs)
}

/// `owner/name` as a GitHub repo.
fn github_remote(full_name: &str) -> Option<RemoteRepo> {
    let (owner, name) = full_name.rsplit_once('/')?;
    (!owner.is_empty() && !name.is_empty()).then(|| RemoteRepo {
        host: "github.com".to_string(),
        owner: owner.to_string(),
        name: name.to_string(),
    })
}

/// The host for a new session, from the renderer's choice. A sandbox clones the
/// repo from GitHub, so the repo has to have a GitHub origin.
pub(crate) fn new_host(
    choice: Option<&str>,
    id: &str,
    repo: Option<&str>,
) -> Result<Option<SessionHost>, String> {
    match choice {
        None | Some("") | Some("local") => Ok(None),
        Some("vercel") => {
            if auth::load().is_none() {
                return Err("Connect Vercel in Integrations first.".to_string());
            }
            let repo = repo.ok_or("Pick a repository to run on Vercel.")?;
            let remote = crate::repo_catalog::origin_of(repo)
                .filter(|r| r.host.eq_ignore_ascii_case("github.com"))
                .ok_or("A Vercel session clones its repository from GitHub, and this one has no GitHub origin.")?;
            Ok(Some(SessionHost::Vercel {
                sandbox: format!("trace-{id}"),
                remote: Some(remote.full_name()),
            }))
        }
        Some(other) => Err(format!("trace can't run agents on {other}.")),
    }
}

/// Take a session another trace started in a sandbox as one of ours, under the
/// same id so both traces address the same sandbox. A no-op if it's already here.
pub(crate) fn adopt(
    workspace_id: &str,
    title: &str,
    sandbox: &str,
    remote: Option<&str>,
    created_at: u64,
) -> Result<ScratchSession, String> {
    if let Some(existing) = load().into_iter().find(|s| s.id == workspace_id) {
        return Ok(existing);
    }
    // The same repo checked out here, if it is: for its name in the list.
    let local_repo = remote.and_then(github_remote).and_then(|r| {
        crate::repo_catalog::known_remotes(&crate::commands::repos::all_repos())
            .into_iter()
            .find(|(known, _)| known.same_as(&r))
            .map(|(_, path)| path)
    });
    let host = SessionHost::Vercel {
        sandbox: sandbox.to_string(),
        remote: remote.map(str::to_string),
    };
    let session = ScratchSession {
        id: workspace_id.to_string(),
        title: title.to_string(),
        cli: "claude".to_string(),
        provider: None,
        created_at,
        archived_at: None,
        tab: None,
        section: None,
        // Its checkout is in the sandbox; `repo` only names it here.
        worktree: false,
        repo: local_repo,
        folder: None,
        agents: Vec::new(),
        remote_control: false,
        created_by: None,
        host: Some(host),
    };
    update(|list| list.push(session.clone()))?;
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_remotes_need_both_parts() {
        let r = github_remote("noble1911/trace").expect("a remote");
        assert_eq!(r.full_name(), "noble1911/trace");
        assert!(github_remote("trace").is_none());
        assert!(github_remote("/trace").is_none());
    }

    #[test]
    fn the_agent_works_in_its_repo_folder() {
        let host = SessionHost::Vercel {
            sandbox: "trace-x".into(),
            remote: Some("noble1911/trace".into()),
        };
        assert_eq!(sandbox_cwd(&host), "/vercel/trace");
    }

    #[test]
    fn this_machine_needs_no_checks() {
        assert_eq!(new_host(None, "x", None), Ok(None));
        assert_eq!(new_host(Some("local"), "x", None), Ok(None));
        assert!(new_host(Some("mars"), "x", None).is_err());
    }
}
