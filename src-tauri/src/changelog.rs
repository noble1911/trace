//! trace's changelog: every published release's notes, for Settings → About.
//!
//! The updater's `latest.json` carries only the newest release's notes, so
//! someone a few versions behind would see just the last one. The releases
//! themselves are public on GitHub, so this reads them from the REST API,
//! without a token (the repo's releases are what the updater installs from
//! anyway; signing in to GitHub isn't needed to update).

use serde::Serialize;
use serde_json::Value;

use crate::github::api::{error_text, http};

/// The repo the updater installs from (`tauri.conf.json`'s updater endpoint;
/// a test keeps the two together).
const REPO: &str = "noble1911/trace";

/// One page of the newest releases: months of history, in one request.
const PER_PAGE: u32 = 100;

/// One published release, as the About tab shows it.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    /// The version without its `v` ("0.16.1").
    pub version: String,
    /// The release's notes (Markdown); empty when it has none.
    pub notes: String,
    /// When it was published (RFC 3339).
    pub published_at: Option<String>,
    /// Its page on GitHub.
    pub url: Option<String>,
}

/// The newest published releases, newest first.
pub async fn fetch() -> Result<Vec<Release>, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases?per_page={PER_PAGE}");
    let resp = http()?
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Reading GitHub's reply failed: {e}"))?;
    if !status.is_success() {
        return Err(error_text(status.as_u16(), &text));
    }
    let body: Value =
        serde_json::from_str(&text).map_err(|e| format!("Unexpected GitHub reply: {e}"))?;
    Ok(parse(&body))
}

/// GitHub's release list → the releases users can install: drafts and
/// pre-releases are left out, as the updater leaves them out.
pub fn parse(body: &Value) -> Vec<Release> {
    let Some(items) = body.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter(|r| !flag(r, "draft") && !flag(r, "prerelease"))
        .filter_map(|r| {
            let tag = r.get("tag_name")?.as_str()?;
            Some(Release {
                version: tag.strip_prefix('v').unwrap_or(tag).to_string(),
                notes: text(r, "body").unwrap_or_default(),
                published_at: text(r, "published_at"),
                url: text(r, "html_url"),
            })
        })
        .collect()
}

fn flag(r: &Value, key: &str) -> bool {
    r.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn text(r: &Value, key: &str) -> Option<String> {
    r.get(key).and_then(Value::as_str).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_published_releases_and_strips_the_v() {
        let body = json!([
            { "tag_name": "v0.17.0", "body": "next", "draft": true },
            { "tag_name": "v0.16.1-rc.1", "body": "rc", "prerelease": true },
            {
                "tag_name": "v0.16.1",
                "body": "## Skills",
                "published_at": "2026-11-17T15:22:14Z",
                "html_url": "https://github.com/noble1911/trace/releases/tag/v0.16.1"
            },
            { "tag_name": "v0.16.0", "body": null }
        ]);
        let releases = parse(&body);
        assert_eq!(releases.len(), 2);
        assert_eq!(releases[0].version, "0.16.1");
        assert_eq!(releases[0].notes, "## Skills");
        assert_eq!(
            releases[0].published_at.as_deref(),
            Some("2026-11-17T15:22:14Z")
        );
        assert_eq!(releases[1].version, "0.16.0");
        assert_eq!(releases[1].notes, "");
    }

    #[test]
    fn a_reply_that_isnt_a_list_is_no_releases() {
        assert!(parse(&json!({ "message": "Not Found" })).is_empty());
    }

    #[test]
    fn reads_the_repo_the_updater_installs_from() {
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json is JSON");
        let endpoint = conf["plugins"]["updater"]["endpoints"][0]
            .as_str()
            .expect("an updater endpoint");
        assert!(
            endpoint.starts_with(&format!("https://github.com/{REPO}/releases/")),
            "{endpoint} isn't {REPO}'s"
        );
    }
}
