//! Reading a skill source over the GitHub REST API, with trace's own token: the
//! repo, its whole file list in one call (`git/trees/HEAD?recursive=1`, the
//! default branch), its `marketplace.json` if it has one, and each `SKILL.md`'s
//! frontmatter. `layout` decides what it all means.

use std::sync::Arc;

use base64::Engine;
use serde_json::Value;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use super::layout::{self, SkillAt, MARKETPLACE};
use super::{Kind, Plugin, Skill, SourceView};
use crate::github::api;
use crate::github::token::Token;

/// `SKILL.md`s read at once.
const PARALLEL: usize = 8;

/// What `repo` (`owner/name`) holds. Err when it can't be read, or holds no
/// skills at all: that isn't a skill source.
pub async fn read(token: &Token, repo: &str) -> Result<SourceView, String> {
    let info = api::get(token, &format!("/repos/{repo}")).await?.body;
    let tree = api::get(token, &format!("/repos/{repo}/git/trees/HEAD?recursive=1"))
        .await
        .map_err(|e| format!("Couldn't list {repo}'s files: {e}"))?
        .body;
    let entries = layout::tree_entries(&tree);
    let (found, capped) = layout::skills(&entries);
    let cut = tree.get("truncated").and_then(Value::as_bool) == Some(true);
    let manifest = entries.iter().find(|e| e.path == MARKETPLACE && !e.is_dir);
    let skills = describe(token, repo, &found).await;
    let mut view = SourceView {
        repo: info
            .get("full_name")
            .and_then(Value::as_str)
            .unwrap_or(repo)
            .to_string(),
        url: info
            .get("html_url")
            .and_then(Value::as_str)
            .map_or_else(|| format!("https://github.com/{repo}"), str::to_string),
        description: info
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        kind: Kind::Folders,
        marketplace: None,
        plugins: Vec::new(),
        skills: Vec::new(),
        truncated: capped || cut,
    };
    if let Some(m) = manifest {
        let text = blob_text(token, repo, &m.sha).await?;
        let json: Value = serde_json::from_str(&text)
            .map_err(|e| format!("{repo}'s marketplace.json isn't valid JSON: {e}"))?;
        let (name, plugins) = layout::marketplace(&json)?;
        view.kind = Kind::Marketplace;
        view.marketplace = Some(name);
        view.plugins = plugins
            .into_iter()
            .map(|entry| {
                let mine = match &entry.folder {
                    Some(folder) => owned(&found, &skills, folder),
                    None => Vec::new(),
                };
                Plugin {
                    entry,
                    skills: mine,
                }
            })
            .collect();
        return Ok(view);
    }
    if skills.is_empty() {
        return Err(format!(
            "{repo} has no skills: no SKILL.md files and no .claude-plugin/marketplace.json."
        ));
    }
    view.skills = skills;
    Ok(view)
}

/// The described skills whose folder is under `folder`.
fn owned(found: &[SkillAt], skills: &[Skill], folder: &str) -> Vec<Skill> {
    let mine: Vec<&str> = layout::under(found, folder)
        .iter()
        .map(|s| s.folder.as_str())
        .collect();
    skills
        .iter()
        .filter(|s| mine.contains(&s.folder.as_str()))
        .cloned()
        .collect()
}

/// Each skill with its frontmatter, in `found`'s order. One that can't be read
/// keeps its folder's name and no description, rather than failing the source.
async fn describe(token: &Token, repo: &str, found: &[SkillAt]) -> Vec<Skill> {
    let gate = Arc::new(Semaphore::new(PARALLEL));
    let mut tasks = JoinSet::new();
    for (i, at) in found.iter().enumerate() {
        let (token, repo, sha, gate) = (
            token.clone(),
            repo.to_string(),
            at.skill_md.clone(),
            gate.clone(),
        );
        tasks.spawn(async move {
            let _permit = gate.acquire_owned().await;
            (i, blob_text(&token, &repo, &sha).await.ok())
        });
    }
    let mut texts: Vec<Option<String>> = vec![None; found.len()];
    while let Some(done) = tasks.join_next().await {
        if let Ok((i, text)) = done {
            texts[i] = text;
        }
    }
    found
        .iter()
        .zip(texts)
        .map(|(at, text)| {
            let (name, description) = text.as_deref().map(layout::frontmatter).unwrap_or_default();
            let folder_name = at
                .folder
                .rsplit('/')
                .next()
                .unwrap_or(&at.folder)
                .to_string();
            Skill {
                name: name.unwrap_or(folder_name),
                description,
                folder: at.folder.clone(),
                folder_sha: at.folder_sha.clone(),
            }
        })
        .collect()
}

/// A blob's text (`GET /repos/…/git/blobs/<sha>`, base64 in JSON).
async fn blob_text(token: &Token, repo: &str, sha: &str) -> Result<String, String> {
    if !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Not a blob id.".into());
    }
    let body = api::get(token, &format!("/repos/{repo}/git/blobs/{sha}"))
        .await?
        .body;
    let encoded: String = body
        .get("content")
        .and_then(Value::as_str)
        .ok_or("GitHub sent a file without content.")?
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "GitHub sent a file trace couldn't decode.".to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// `TRACE_SKILLS_REPO=owner/name cargo test skills_live -- --ignored --nocapture`:
/// reads a real source with trace's saved GitHub token, printing its shape only.
#[cfg(test)]
mod live {
    #[tokio::test]
    #[ignore]
    async fn skills_live() {
        let Ok(repo) = std::env::var("TRACE_SKILLS_REPO") else {
            eprintln!("set TRACE_SKILLS_REPO=owner/name");
            return;
        };
        let token = crate::github::account::require_token().expect("trace's GitHub token");
        let view = super::read(&token, &repo).await.expect("read");
        println!(
            "{} · {:?} · marketplace {:?} · truncated {}",
            view.repo, view.kind, view.marketplace, view.truncated
        );
        for p in &view.plugins {
            println!(
                "  plugin {} v{:?}: {} skills",
                p.entry.name,
                p.entry.version,
                p.skills.len()
            );
        }
        let all = view
            .plugins
            .iter()
            .flat_map(|p| &p.skills)
            .chain(&view.skills);
        for s in all.take(6) {
            println!(
                "    {} — {} chars of description",
                s.name,
                s.description.as_deref().map_or(0, str::len)
            );
        }
        println!("  folder skills: {}", view.skills.len());
    }
}
