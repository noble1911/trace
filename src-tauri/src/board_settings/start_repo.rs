//! Which repo a card's agent starts in, as far as its board decides it. Order: the
//! ticket's saved assignment, else the board's repos (one: it; several: the
//! default, else ask), else today's rules (mappings, sole repo), which
//! `commands::repos` already applies once nothing is pinned.

use super::BoardSettings;

/// What `start_agent` gets told. Today's rules aren't run here: they're the
/// existing resolution, which a cloud-sandbox start may never need.
#[derive(PartialEq, Eq, Debug)]
pub enum StartRepo {
    /// The ticket is already pinned to this repo: nothing to do.
    Saved(String),
    /// The board picks this repo; pin it as the ticket's assignment.
    Board(String),
    /// The board says nothing: today's rules decide.
    Fallback,
}

/// The error the frontend's repo picker keys on ("No repository assigned"), the
/// same text `commands::repos` gives when today's rules can't choose.
pub const NO_REPO: &str = "No repository assigned yet — pick one to start.";

/// Resolve a start against the board. `saved` is the ticket's assignment;
/// `configured` the repos in `repos.json`, so a board repo that has since gone
/// (and whose cleanup failed) is never chosen. Several repos with no usable
/// default is `NO_REPO`, so the picker opens.
pub fn resolve(
    saved: Option<&str>,
    board: &BoardSettings,
    configured: &[String],
) -> Result<StartRepo, String> {
    if let Some(repo) = saved {
        return Ok(StartRepo::Saved(repo.to_string()));
    }
    let repos: Vec<&String> = board
        .repos
        .iter()
        .filter(|r| configured.contains(r))
        .collect();
    match repos.as_slice() {
        [] => Ok(StartRepo::Fallback),
        [only] => Ok(StartRepo::Board(only.to_string())),
        several => board
            .default_repo
            .as_ref()
            .filter(|d| several.contains(d))
            .map(|d| StartRepo::Board(d.clone()))
            .ok_or_else(|| NO_REPO.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(repos: &[&str], default_repo: Option<&str>) -> BoardSettings {
        BoardSettings {
            kickoff_prompt: None,
            repos: repos.iter().map(|r| r.to_string()).collect(),
            default_repo: default_repo.map(str::to_string),
        }
    }

    fn configured() -> Vec<String> {
        vec!["/a".into(), "/b".into(), "/c".into()]
    }

    #[test]
    fn a_saved_assignment_wins_over_the_board() {
        let board = settings(&["/a", "/b"], None);
        assert_eq!(
            resolve(Some("/c"), &board, &configured()),
            Ok(StartRepo::Saved("/c".into()))
        );
    }

    #[test]
    fn one_board_repo_is_used() {
        let board = settings(&["/b"], None);
        assert_eq!(
            resolve(None, &board, &configured()),
            Ok(StartRepo::Board("/b".into()))
        );
    }

    #[test]
    fn several_use_the_default_or_ask() {
        let with_default = settings(&["/a", "/b"], Some("/b"));
        assert_eq!(
            resolve(None, &with_default, &configured()),
            Ok(StartRepo::Board("/b".into()))
        );
        let without = settings(&["/a", "/b"], None);
        let err = resolve(None, &without, &configured()).expect_err("asks");
        assert!(err.contains("No repository assigned"));
    }

    #[test]
    fn no_board_repos_fall_back_to_todays_rules() {
        assert_eq!(
            resolve(None, &BoardSettings::default(), &configured()),
            Ok(StartRepo::Fallback)
        );
    }

    #[test]
    fn repos_no_longer_configured_are_ignored() {
        let one_left = settings(&["/gone", "/a"], Some("/gone"));
        assert_eq!(
            resolve(None, &one_left, &configured()),
            Ok(StartRepo::Board("/a".into()))
        );
        let none_left = settings(&["/gone"], None);
        assert_eq!(
            resolve(None, &none_left, &configured()),
            Ok(StartRepo::Fallback)
        );
        let stale_default = settings(&["/a", "/b", "/gone"], Some("/gone"));
        assert!(resolve(None, &stale_default, &configured()).is_err());
    }
}
