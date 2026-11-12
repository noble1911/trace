//! Board settings: what any board (Jira, Pylon or custom) adds to a start of one
//! of its cards: its own kickoff brief and the repositories its cards run in.
//! Kept by the board's switcher key (`provider:boardId`) in `board-settings.json`
//! (`store`). The rules here are pure functions, so they're tested without a disk.
//! See `docs/BOARDS_PLAN.md`, "Board setup".

pub mod pin;
pub mod start_repo;
pub mod store;

use serde::{Deserialize, Serialize};

/// The longest brief a board (or a card type) may carry, in characters. Generous
/// for any real brief, but a pasted log or file doesn't reach every agent's prompt.
pub const MAX_PROMPT_CHARS: usize = 20_000;

/// The trackers a board key may name: the provider kinds that have boards.
const PROVIDERS: [&str; 3] = ["jira", "pylon", "custom"];

/// One board's settings. All-default means "nothing set": the global brief and
/// today's repo rules, and no entry in the file.
#[derive(Serialize, Deserialize, Clone, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardSettings {
    /// The board's brief; `None` uses the global one from Settings.
    #[serde(default)]
    pub kickoff_prompt: Option<String>,
    /// Configured repo paths its cards start in; empty means today's rules.
    #[serde(default)]
    pub repos: Vec<String>,
    /// One of `repos`, used when there are several; `None` asks at the start.
    #[serde(default)]
    pub default_repo: Option<String>,
}

impl BoardSettings {
    /// Whether these are the defaults, so saving them removes the board's entry.
    pub fn is_default(&self) -> bool {
        *self == BoardSettings::default()
    }
}

/// Check a board key's shape: `<provider>:<boardId>` with a known provider and a
/// non-empty id. A malformed key would file settings no board ever reads.
pub fn check_key(key: &str) -> Result<(), String> {
    let (provider, id) = key
        .split_once(':')
        .ok_or_else(|| format!("\"{key}\" isn't a board key (provider:boardId)."))?;
    if !PROVIDERS.contains(&provider) {
        return Err(format!(
            "Unknown board provider \"{provider}\": use jira, pylon or custom."
        ));
    }
    if id.trim().is_empty() {
        return Err(format!("\"{key}\" names no board."));
    }
    Ok(())
}

/// A brief as it's kept: trimmed, empty is none, refused past the cap. `what`
/// names whose brief it is in the refusal.
pub fn clean_prompt(prompt: Option<String>, what: &str) -> Result<Option<String>, String> {
    let Some(prompt) = prompt
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
    else {
        return Ok(None);
    };
    let chars = prompt.chars().count();
    if chars > MAX_PROMPT_CHARS {
        return Err(format!(
            "{what}'s brief is {chars} characters; keep it under {MAX_PROMPT_CHARS}."
        ));
    }
    Ok(Some(prompt))
}

/// Settings as they're saved: the prompt cleaned, each repo once and configured
/// (`configured` is the repo list in `repos.json`), and the default one of them.
pub fn validate(settings: BoardSettings, configured: &[String]) -> Result<BoardSettings, String> {
    let kickoff_prompt = clean_prompt(settings.kickoff_prompt, "The board")?;
    let mut repos: Vec<String> = Vec::new();
    for repo in settings.repos {
        if !configured.contains(&repo) {
            return Err(format!("{repo} isn't one of trace's repositories."));
        }
        if !repos.contains(&repo) {
            repos.push(repo);
        }
    }
    let default_repo = settings.default_repo.filter(|r| !r.is_empty());
    if let Some(repo) = &default_repo {
        if !repos.contains(repo) {
            return Err(format!(
                "The default repository {repo} isn't one of the board's."
            ));
        }
    }
    Ok(BoardSettings {
        kickoff_prompt,
        repos,
        default_repo,
    })
}

/// `settings` without `repo`, the default cleared when it was that one. For when a
/// repo is removed from trace.
pub fn without_repo(mut settings: BoardSettings, repo: &str) -> BoardSettings {
    settings.repos.retain(|r| r != repo);
    if settings.default_repo.as_deref() == Some(repo) {
        settings.default_repo = None;
    }
    settings
}

#[cfg(test)]
mod tests;
