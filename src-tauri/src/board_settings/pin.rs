//! Pinning a ticket to its board's repo as its agent starts, and taking that
//! back when the start fails.
//!
//! When the ticket has no repo of its own and its board's settings pick one,
//! that repo becomes the ticket's assignment (as the repo picker would pin it),
//! so the start and later diff/PR/tests resolve it. It's pinned before the rest
//! of the start because a sandbox start resolves the repo through it; if the
//! start then fails before the worktree exists (a busy repo, a sandbox that
//! won't open), [`unpin`] removes it again, so a failed start leaves the ticket
//! as it was and a later change to the board's repos still applies.
//!
//! Board settings never block a start: the one error is `NO_REPO` (several
//! board repos and no default), which the frontend's picker opens on. Anything
//! unreadable is logged, and today's rules (mappings, sole repo) decide.

use super::start_repo::{self, StartRepo};
use super::{check_key, store, BoardSettings};
use crate::commands::repos;

/// The repo to pin, from what was read: Some to pin, None to leave the start
/// to today's rules. `saved` and `configured` are read only when the board
/// has repos. Err only for `NO_REPO`; every read failure is logged and None.
pub fn board_pick(
    settings: Result<BoardSettings, String>,
    saved: impl FnOnce() -> Result<Option<String>, String>,
    configured: impl FnOnce() -> Result<Vec<String>, String>,
) -> Result<Option<String>, String> {
    let fallback = |what: &str, e: String| {
        eprintln!("trace: {what} unreadable, using today's repo rules: {e}");
        Ok(None)
    };
    let settings = match settings {
        Ok(s) => s,
        Err(e) => return fallback("board settings", e),
    };
    if settings.repos.is_empty() {
        return Ok(None);
    }
    let saved = match saved() {
        Ok(s) => s,
        Err(e) => return fallback("the ticket's repo", e),
    };
    let configured = match configured() {
        Ok(c) => c,
        Err(e) => return fallback("the repo list", e),
    };
    match start_repo::resolve(saved.as_deref(), &settings, &configured)? {
        StartRepo::Board(repo) => Ok(Some(repo)),
        StartRepo::Saved(_) | StartRepo::Fallback => Ok(None),
    }
}

/// Before a ticket's agent starts: pin `issue_key` to its board's repo when
/// the board (`board_key`, `provider:boardId`) picks one and the ticket has
/// none. Answers the repo pinned, for [`unpin`] should the start fail.
pub fn pin(issue_key: &str, board_key: Option<&str>) -> Result<Option<String>, String> {
    let Some(key) = board_key.filter(|k| check_key(k).is_ok()) else {
        return Ok(None);
    };
    let picked = board_pick(
        store::get(&store::default_path(), key),
        || repos::issue_repo(issue_key.to_string()),
        repos::list_repos,
    )?;
    let Some(repo) = picked else {
        return Ok(None);
    };
    match repos::assign_repo(issue_key, &repo) {
        Ok(()) => Ok(Some(repo)),
        Err(e) => {
            eprintln!("trace: couldn't pin {issue_key} to its board's repo: {e}");
            Ok(None)
        }
    }
}

/// After a start that failed before its worktree existed: take back the pin
/// [`pin`] made, if the ticket is still pinned to that repo. Best-effort: the
/// start's own error is what the user needs to see.
pub fn unpin(issue_key: &str, pinned: Option<&str>) {
    let Some(repo) = pinned else { return };
    if let Err(e) = repos::unassign_repo(issue_key, repo) {
        eprintln!("trace: couldn't undo {issue_key}'s repo pin after a failed start: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board(repos: &[&str], default_repo: Option<&str>) -> Result<BoardSettings, String> {
        Ok(BoardSettings {
            kickoff_prompt: None,
            repos: repos.iter().map(|r| r.to_string()).collect(),
            default_repo: default_repo.map(str::to_string),
        })
    }

    fn configured() -> Result<Vec<String>, String> {
        Ok(vec!["/a".into(), "/b".into()])
    }

    #[test]
    fn the_boards_repo_is_pinned_for_a_ticket_without_one() {
        let picked = board_pick(board(&["/b"], None), || Ok(None), configured);
        assert_eq!(picked, Ok(Some("/b".into())));
        let saved = board_pick(board(&["/b"], None), || Ok(Some("/a".into())), configured);
        assert_eq!(saved, Ok(None), "the ticket's own repo stands");
    }

    #[test]
    fn nothing_unreadable_blocks_a_start() {
        let broken = || Err::<Option<String>, String>("repos.json is locked".into());
        assert_eq!(
            board_pick(board(&["/b"], None), broken, configured),
            Ok(None)
        );
        let no_list = || Err::<Vec<String>, String>("unreadable".into());
        assert_eq!(
            board_pick(board(&["/b"], None), || Ok(None), no_list),
            Ok(None)
        );
        let no_settings = Err("board-settings.json is from a newer trace".to_string());
        assert_eq!(board_pick(no_settings, || Ok(None), configured), Ok(None));
    }

    #[test]
    fn several_repos_and_no_default_still_ask() {
        let err = board_pick(board(&["/a", "/b"], None), || Ok(None), configured);
        assert_eq!(err, Err(start_repo::NO_REPO.to_string()));
    }

    #[test]
    fn a_board_without_repos_reads_nothing_else() {
        let unread = || -> Result<Option<String>, String> { panic!("not read") };
        assert_eq!(board_pick(board(&[], None), unread, configured), Ok(None));
    }
}
