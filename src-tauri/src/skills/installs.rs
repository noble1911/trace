//! What's installed where, for the Skills tab, and installing, updating and
//! removing a plugin. Read from Claude Code and the projects every time, never
//! kept: trace holds no copy that could go stale (`docs/SKILLS_PLAN.md`).

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::cli::{self, Installed, Scope};
use super::project;

/// One of trace's repositories, and its plugins.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInstalls {
    /// The repo as Settings → Repositories lists it.
    pub repo: String,
    /// Installed in its main checkout, for everyone (`project`) or just this
    /// person (`local`).
    pub installed: Vec<Installed>,
    /// Enabled for everyone on the branch new worktrees start from.
    pub committed: Vec<String>,
}

/// Every install the Skills tab shows.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installs {
    /// Everywhere, for this person.
    pub user: Vec<Installed>,
    pub projects: Vec<ProjectInstalls>,
}

/// `path` as the file system resolves it (symlinks, `/tmp` → `/private/tmp`), so
/// it compares with Claude Code's `projectPath`; as given if it can't be.
fn real(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}

/// Sort `all` into this person's installs and each repo's. An install in a repo's
/// worktree (Claude Code records one per worktree that enables a committed
/// plugin) or in a folder trace doesn't know is not shown.
pub fn group(
    all: Vec<Installed>,
    repos: &[(String, PathBuf)],
) -> (Vec<Installed>, Vec<Vec<Installed>>) {
    let mut user = Vec::new();
    let mut per_repo = vec![Vec::new(); repos.len()];
    for i in all {
        match i.scope {
            Scope::User => user.push(i),
            Scope::Project | Scope::Local => {
                let at = i.project_path.as_deref().map(real);
                if let Some(n) = repos.iter().position(|(_, p)| Some(p) == at.as_ref()) {
                    per_repo[n].push(i);
                }
            }
            Scope::Other => {}
        }
    }
    (user, per_repo)
}

/// Everything installed, by where. Blocking (Claude Code and git each run).
pub fn read(repos: &[String]) -> Result<Installs, String> {
    let home = dirs::home_dir().ok_or("No home folder")?;
    let (ok, out, err) = cli::run(&cli::list_args(), &home)?;
    if !ok {
        return Err(cli::parse_outcome(&out, &err).err().unwrap_or_default());
    }
    let real_repos: Vec<(String, PathBuf)> = repos.iter().map(|r| (r.clone(), real(r))).collect();
    let (user, per_repo) = group(cli::parse_list(&out)?, &real_repos);
    let projects = repos
        .iter()
        .zip(per_repo)
        .map(|(repo, installed)| ProjectInstalls {
            repo: repo.clone(),
            installed,
            committed: project::committed_plugins(repo),
        })
        .collect();
    Ok(Installs { user, projects })
}

/// Where a scope's command runs: the project's root, or anywhere for `user`.
fn cwd(scope: Scope, repo: Option<&str>) -> Result<PathBuf, String> {
    match (scope, repo) {
        (Scope::User, _) => dirs::home_dir().ok_or_else(|| "No home folder".into()),
        (Scope::Project | Scope::Local, Some(repo)) if Path::new(repo).is_dir() => {
            Ok(PathBuf::from(repo))
        }
        (Scope::Project | Scope::Local, _) => Err("Pick a repository to install it in.".into()),
        (Scope::Other, _) => Err("trace doesn't install into that scope.".into()),
    }
}

fn act(args: &[String], scope: Scope, repo: Option<&str>) -> Result<String, String> {
    let (_, out, err) = cli::run(args, &cwd(scope, repo)?)?;
    cli::parse_outcome(&out, &err)
}

/// Install `plugin` from the marketplace in GitHub repo `source`, for `scope`
/// (in `repo`, for a project's scopes). Returns Claude Code's message.
pub fn install(
    source: &str,
    plugin: &str,
    scope: Scope,
    repo: Option<&str>,
) -> Result<String, String> {
    act(&cli::install_args(plugin, source, scope)?, scope, repo)
}

/// Remove plugin `id` from `scope`.
pub fn uninstall(id: &str, scope: Scope, repo: Option<&str>) -> Result<String, String> {
    act(&cli::uninstall_args(id, scope)?, scope, repo)
}

/// Bring plugin `id` up to its marketplace's latest, re-reading the marketplace
/// first.
pub fn update(id: &str, scope: Scope, repo: Option<&str>) -> Result<String, String> {
    let [refresh, update] = cli::update_args(id, scope)?;
    act(&refresh, scope, repo)?;
    act(&update, scope, repo)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(id: &str, scope: Scope, path: Option<&str>) -> Installed {
        Installed {
            id: id.into(),
            version: Some("1.0.0".into()),
            scope,
            enabled: true,
            project_path: path.map(str::to_string),
        }
    }

    #[test]
    fn sorts_installs_into_yours_and_each_repos() {
        let repos = vec![
            ("/r/web".to_string(), PathBuf::from("/r/web")),
            ("/r/api".to_string(), PathBuf::from("/r/api")),
        ];
        let all = vec![
            at("a@m", Scope::User, None),
            at("b@m", Scope::Project, Some("/r/api")),
            at("c@m", Scope::Local, Some("/r/web")),
            // Claude Code's record for a worktree enabling a committed plugin.
            at("b@m", Scope::Project, Some("/r/api/.worktrees/pm-1")),
            at("d@m", Scope::Project, Some("/elsewhere")),
            at("e@m", Scope::Other, None),
        ];
        let (user, per_repo) = group(all, &repos);
        assert_eq!(user.iter().map(|i| &i.id).collect::<Vec<_>>(), ["a@m"]);
        assert_eq!(
            per_repo[0].iter().map(|i| &i.id).collect::<Vec<_>>(),
            ["c@m"]
        );
        assert_eq!(
            per_repo[1].iter().map(|i| &i.id).collect::<Vec<_>>(),
            ["b@m"]
        );
    }

    /// Reads this machine's real installs over trace's repositories (read-only):
    /// `cargo test skills_installs_live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn skills_installs_live() {
        let repos = crate::commands::repos::list_repos().expect("repos");
        let all = read(&repos).expect("read");
        println!(
            "user: {:?}",
            all.user.iter().map(|i| &i.id).collect::<Vec<_>>()
        );
        for p in &all.projects {
            let ids: Vec<_> = p.installed.iter().map(|i| (&i.id, i.scope)).collect();
            println!("{}: installed {ids:?} committed {:?}", p.repo, p.committed);
        }
    }

    /// Installs a plugin "Just me" into a scratch repo through the real Claude Code,
    /// finds it there, and removes it: `TRACE_SKILLS_PLUGIN=support@obsidian
    /// TRACE_SKILLS_REPO=owner/name cargo test skills_install_live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn skills_install_live() {
        let (Ok(id), Ok(source)) = (
            std::env::var("TRACE_SKILLS_PLUGIN"),
            std::env::var("TRACE_SKILLS_REPO"),
        ) else {
            eprintln!("set TRACE_SKILLS_PLUGIN=<plugin>@<marketplace> and TRACE_SKILLS_REPO");
            return;
        };
        let plugin = id.split('@').next().expect("plugin");
        let dir = std::env::temp_dir().join(format!("trace-skills-live-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let repo = dir.to_string_lossy().into_owned();
        crate::claude::discovery::command("git")
            .args(["init", "-q"])
            .current_dir(&dir)
            .status()
            .expect("git init");

        println!(
            "install: {:?}",
            install(&source, plugin, Scope::Local, Some(&repo))
        );
        let found = read(std::slice::from_ref(&repo)).expect("read");
        let here: Vec<_> = found.projects[0]
            .installed
            .iter()
            .map(|i| (&i.id, i.scope))
            .collect();
        println!("found in the scratch repo: {here:?}");
        assert!(here.iter().any(|(i, s)| **i == id && *s == Scope::Local));
        println!("update: {:?}", update(&id, Scope::Local, Some(&repo)));
        println!("remove: {:?}", uninstall(&id, Scope::Local, Some(&repo)));
        let after = read(std::slice::from_ref(&repo)).expect("read");
        assert!(after.projects[0].installed.is_empty(), "removed");
    }

    #[test]
    fn a_projects_scope_needs_a_repository() {
        assert!(cwd(Scope::Project, None).is_err());
        assert!(cwd(Scope::Local, Some("/no/such/repo")).is_err());
        assert!(cwd(Scope::Other, None).is_err());
        assert!(cwd(Scope::User, None).is_ok());
    }
}
