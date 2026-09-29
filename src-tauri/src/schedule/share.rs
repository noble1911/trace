//! Sharing scheduled prompts between people: a portable JSON file.
//!
//! An export keeps only what means the same on someone else's machine — the
//! prompt, its schedule and how it runs. Ids, run history and timestamps are
//! local, and the repo is an absolute path, so only its folder name travels: a
//! hint the importer's side matches against their own repos. Provider keys never
//! leave — only the provider id does, and the recipient runs it on their own key.
//!
//! Imports arrive **paused**. A shared file can carry flags like
//! `--dangerously-skip-permissions`, and the runner fires unattended, so nothing
//! runs until the recipient has read it and resumed it.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::model::{PromptInput, ScheduledPrompt};
use super::timing::Schedule;
use super::{now_secs, store};

/// Marks a trace export, so importing some other JSON fails with a clear message.
const FORMAT: &str = "trace.scheduled-prompts";
/// Bumped on a breaking change to `SharedPrompt`; files from a newer trace are refused.
const VERSION: u64 = 1;
/// A real export is a few KB — refuse anything past this rather than parse it.
const MAX_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Bundle {
    format: String,
    version: u64,
    prompts: Vec<SharedPrompt>,
}

/// One prompt as it travels between machines (mirrored in the frontend's
/// `domains/schedules/types.ts`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharedPrompt {
    pub title: String,
    pub prompt: String,
    pub schedule: Schedule,
    /// Folder name of the exporter's repo — only a hint for picking one of yours.
    #[serde(default)]
    pub repo_name: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub extra_args: Vec<String>,
    pub timeout_mins: u32,
    pub notify: bool,
}

/// A shared prompt plus the repo it goes into here. `read` proposes the repo;
/// the import preview lets the user change it before sending the list back.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub shared: SharedPrompt,
    pub repo: Option<String>,
}

/// Write the prompts in `ids` to `path` (picked in a save dialog). Returns how
/// many were written. The file is deliberately not `0600`: it's meant to be
/// handed to someone, and it lives wherever the user saved it, not the config dir.
pub fn export(ids: &[String], path: &Path) -> Result<usize, String> {
    let prompts: Vec<SharedPrompt> = store::prompts()
        .into_iter()
        .filter(|p| ids.contains(&p.id))
        .map(to_shared)
        .collect();
    if prompts.is_empty() {
        return Err("Pick at least one prompt to export.".to_string());
    }
    let count = prompts.len();
    let bundle = Bundle {
        format: FORMAT.to_string(),
        version: VERSION,
        prompts,
    };
    let json = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?;
    std::fs::write(path, json + "\n").map_err(|e| format!("Couldn't write the file: {e}"))?;
    Ok(count)
}

/// Read a shared file for the import preview, matching each prompt to one of
/// this machine's repos. Saves nothing.
pub fn read(path: &Path) -> Result<Vec<ImportItem>, String> {
    let size = std::fs::metadata(path)
        .map_err(|e| format!("Couldn't open the file: {e}"))?
        .len();
    if size > MAX_FILE_BYTES {
        return Err("That file is too big to be a trace export.".to_string());
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("Couldn't read the file: {e}"))?;
    let repos = crate::commands::repos::all_repos();
    Ok(parse(&text)?
        .into_iter()
        .map(|shared| ImportItem {
            repo: match_repo(shared.repo_name.as_deref(), &repos),
            shared,
        })
        .collect())
}

/// Save previewed prompts as new, paused prompts. All or nothing: if one fails
/// validation (say its repo was removed meanwhile), none are saved and the error
/// names it.
pub fn import(items: Vec<ImportItem>) -> Result<Vec<ScheduledPrompt>, String> {
    if items.is_empty() {
        return Err("Pick at least one prompt to import.".to_string());
    }
    let now = now_secs();
    let built = items
        .into_iter()
        .map(|item| {
            let title = item.shared.title.trim().to_string();
            to_input(item)
                .build(None, now)
                .map(|p| ScheduledPrompt {
                    enabled: false,
                    next_run_at: None,
                    ..p
                })
                .map_err(|e| format!("“{title}”: {e}"))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let saved = built.clone();
    store::update_prompts(move |list| list.extend(built))?;
    Ok(saved)
}

/// Check the envelope before the prompts, so an unrelated JSON file reads "not a
/// trace export" instead of a serde complaint about a missing field.
fn parse(text: &str) -> Result<Vec<SharedPrompt>, String> {
    let not_ours = || "That isn't a trace scheduled-prompts export.".to_string();
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| not_ours())?;
    if value.get("format").and_then(|f| f.as_str()) != Some(FORMAT) {
        return Err(not_ours());
    }
    let version = value
        .get("version")
        .and_then(|v| v.as_u64())
        .ok_or_else(not_ours)?;
    if version > VERSION {
        return Err("That file comes from a newer trace — update to import it.".to_string());
    }
    let bundle: Bundle =
        serde_json::from_value(value).map_err(|e| format!("That file is damaged: {e}"))?;
    if bundle.prompts.is_empty() {
        return Err("That file has no prompts in it.".to_string());
    }
    // A provider this build doesn't know would silently run on Anthropic;
    // normalize it now so the preview shows what will actually be saved.
    Ok(bundle
        .prompts
        .into_iter()
        .map(|p| SharedPrompt {
            provider: p
                .provider
                .filter(|id| crate::commands::providers::spec(id).is_some()),
            ..p
        })
        .collect())
}

fn to_shared(p: ScheduledPrompt) -> SharedPrompt {
    // `None` means "the default repo", so hint with that one's name.
    let repo = p.repo.or_else(crate::commands::repos::default_repo);
    SharedPrompt {
        title: p.title,
        prompt: p.prompt,
        schedule: p.schedule,
        repo_name: repo.as_deref().map(folder_name),
        provider: p.provider,
        model: p.model,
        extra_args: p.extra_args,
        timeout_mins: p.timeout_mins,
        notify: p.notify,
    }
}

fn to_input(item: ImportItem) -> PromptInput {
    let s = item.shared;
    PromptInput {
        id: None,
        title: s.title,
        prompt: s.prompt,
        repo: item.repo,
        provider: s.provider,
        model: s.model,
        extra_args: s.extra_args,
        schedule: s.schedule,
        timeout_mins: s.timeout_mins,
        notify: s.notify,
    }
}

/// The repo here whose folder is named like the exporter's, else the default
/// (first) one. `None` only when no repo is configured.
fn match_repo(repo_name: Option<&str>, repos: &[String]) -> Option<String> {
    repo_name
        .and_then(|name| repos.iter().find(|r| folder_name(r) == name))
        .or_else(|| repos.first())
        .cloned()
}

fn folder_name(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    trimmed.rsplit('/').next().unwrap_or(trimmed).to_string()
}

#[cfg(test)]
mod tests {
    use super::{match_repo, parse, Bundle, SharedPrompt, FORMAT, VERSION};
    use crate::schedule::timing::Schedule;

    fn sample() -> SharedPrompt {
        SharedPrompt {
            title: "Morning triage".to_string(),
            prompt: "Review PRs since {lastRunAt}".to_string(),
            schedule: Schedule::Daily {
                time: "09:00".to_string(),
            },
            repo_name: Some("trace".to_string()),
            provider: Some("deepseek".to_string()),
            model: None,
            extra_args: vec!["--permission-mode".to_string(), "acceptEdits".to_string()],
            timeout_mins: 30,
            notify: true,
        }
    }

    fn file(prompts: Vec<SharedPrompt>) -> String {
        serde_json::to_string(&Bundle {
            format: FORMAT.to_string(),
            version: VERSION,
            prompts,
        })
        .unwrap_or_default()
    }

    #[test]
    fn round_trips_an_export() {
        assert_eq!(parse(&file(vec![sample()])), Ok(vec![sample()]));
    }

    #[test]
    fn refuses_foreign_newer_and_empty_files() {
        assert!(parse("not json").is_err());
        assert!(parse(r#"{"format":"something-else","version":1,"prompts":[]}"#).is_err());
        let newer = file(vec![sample()]).replace(r#""version":1"#, r#""version":99"#);
        assert!(parse(&newer).unwrap_err().contains("newer trace"));
        assert!(parse(&file(vec![])).unwrap_err().contains("no prompts"));
    }

    #[test]
    fn drops_providers_this_build_does_not_know() {
        let mut p = sample();
        p.provider = Some("some-future-provider".to_string());
        let parsed = parse(&file(vec![p])).unwrap_or_default();
        assert_eq!(parsed[0].provider, None);
    }

    #[test]
    fn matches_repos_by_folder_name_then_falls_back_to_the_default() {
        let repos = vec!["/code/api".to_string(), "/Users/me/src/trace/".to_string()];
        let pick = |name: Option<&str>| match_repo(name, &repos);
        assert_eq!(pick(Some("trace")).as_deref(), Some("/Users/me/src/trace/"));
        assert_eq!(pick(Some("elsewhere")).as_deref(), Some("/code/api"));
        assert_eq!(pick(None).as_deref(), Some("/code/api"));
        assert_eq!(match_repo(Some("trace"), &[]), None);
    }
}
