//! One pull request's state and discussion, in a single GraphQL round trip.
//!
//! REST would need four calls (PR, issue comments, reviews, review comments) and
//! still not say whether an inline thread is resolved. One `gh api graphql`
//! query gets all of it — cheap enough to poll, which matters because bots
//! (coverage, previews, AI reviewers) edit one comment in place rather than
//! posting new ones: `lastEditedAt` is how the rail notices.

use serde::Serialize;

use super::links::parse_pr_url;

/// One comment inside an inline review thread (the first is the thread's own).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub id: String,
    pub author: String,
    pub is_bot: bool,
    pub body: String,
    pub url: String,
    pub created_at: String,
    /// When the body was last edited; `None` if never.
    pub edited_at: Option<String>,
}

/// One item in the PR's conversation: a top-level comment, a review's summary,
/// or an inline code thread (with its replies).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrEntry {
    /// "comment" | "review" | "thread".
    pub kind: String,
    #[serde(flatten)]
    pub head: PrComment,
    /// Review verdict for `review`: "approved" | "changes" | "commented" | "dismissed".
    pub review_state: Option<String>,
    /// File + line for `thread`.
    pub path: Option<String>,
    pub line: Option<u64>,
    pub resolved: bool,
    pub outdated: bool,
    pub replies: Vec<PrComment>,
    /// Latest create/edit time across the entry and its replies — the sort key,
    /// and the signature the renderer diffs to flag "edited" / "new reply".
    pub activity_at: String,
}

/// A PR as the rail shows it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrThread {
    pub url: String,
    pub number: u64,
    pub title: String,
    /// "open" | "draft" | "merged" | "closed".
    pub state: String,
    pub author: String,
    pub head_ref: String,
    pub base_ref: String,
    pub additions: u64,
    pub deletions: u64,
    /// "approved" | "changes" | "review" (required, not yet given) | None.
    pub review_decision: Option<String>,
    /// CI rollup on the head commit: "ok" | "fail" | "pending" | None (no checks).
    pub checks: Option<String>,
    pub updated_at: String,
    /// Newest activity first.
    pub entries: Vec<PrEntry>,
}

const QUERY: &str = r#"
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url number title state isDraft headRefName baseRefName additions deletions
      reviewDecision updatedAt
      author { login __typename }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      comments(last: 60) { nodes {
        id body url createdAt lastEditedAt isMinimized author { login __typename } } }
      reviews(last: 40) { nodes {
        id body url state createdAt lastEditedAt author { login __typename } } }
      reviewThreads(last: 60) { nodes {
        isResolved isOutdated path line originalLine
        comments(first: 30) { nodes {
          id body url createdAt lastEditedAt author { login __typename } } } } }
    }
  }
}"#;

/// Fetch a PR by URL, as whichever signed-in account can see its repo (`gh`).
/// Run from the workspace so a repo-local `gh` config still applies.
pub fn fetch(cwd: &str, pr_url: &str) -> Result<PrThread, String> {
    let (owner, name, number) =
        parse_pr_url(pr_url).ok_or_else(|| format!("Not a GitHub PR URL: {pr_url}"))?;
    // -f keeps owner/name strings (a numeric org name must not become an Int);
    // -F types the number.
    let args: Vec<String> = vec![
        "api".into(),
        "graphql".into(),
        "-f".into(),
        format!("query={QUERY}"),
        "-f".into(),
        format!("owner={owner}"),
        "-f".into(),
        format!("name={name}"),
        "-F".into(),
        format!("number={number}"),
    ];
    let stdout = super::gh::run(cwd, &owner, &args)?;
    let json: serde_json::Value =
        serde_json::from_slice(&stdout).map_err(|e| format!("bad gh json: {e}"))?;
    super::thread_parse::parse(&json).ok_or_else(|| format!("GitHub returned no PR for {pr_url}"))
}
