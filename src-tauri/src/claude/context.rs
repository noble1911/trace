//! Where an agent is, told to it on every start: a ticket's agent learns which
//! tracker's ticket it's for ("Jira ticket PM-1234", "Pylon ticket #1234").
//!
//! The kickoff brief names the ticket too, but only in a fresh conversation's
//! first message, and only if the user's template keeps `{key}`. A resumed
//! conversation, an interrupted agent brought back, or one whose early turns were
//! compacted away would otherwise not know. So it rides in the system prompt
//! (Claude's `--append-system-prompt`) or the instructions (Codex), set at every
//! spawn. A ticket's workspace id is its key; that includes a session linked to a
//! ticket, which runs as the ticket's workspace. Sessions and scheduled runs get
//! nothing.

use crate::issues::ProviderKind;

const FLAG: &str = "--append-system-prompt";

/// The tracker's name, as the rest of trace shows it.
fn tracker_name(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Jira => "Jira",
        ProviderKind::Pylon => "Pylon",
    }
}

/// What to tell the agent of `workspace_id` about where it is, if it's a ticket's.
pub fn workspace_context(workspace_id: &str) -> Option<String> {
    if !crate::activity::looks_like_issue_key(workspace_id) {
        return None;
    }
    let tracker = tracker_name(ProviderKind::for_issue_key(workspace_id));
    Some(format!(
        "You are running in trace as the agent for {tracker} ticket {workspace_id}: this \
         worktree, branch and conversation are that ticket's. Call it {tracker} ticket \
         {workspace_id} when you mention it."
    ))
}

/// `args` with the context for `workspace_id` in Claude's system prompt. A
/// `--append-system-prompt` the user already passes is kept, ours after it: a
/// second flag would replace theirs.
pub fn with_context(mut args: Vec<String>, workspace_id: &str) -> Vec<String> {
    let Some(context) = workspace_context(workspace_id) else {
        return args;
    };
    let inline = format!("{FLAG}=");
    if let Some(at) = args.iter().position(|a| a.starts_with(&inline)) {
        args[at] = format!("{}\n\n{context}", args[at]);
    } else if let Some(at) = args.iter().position(|a| a == FLAG) {
        match args.get_mut(at + 1) {
            Some(theirs) => *theirs = format!("{theirs}\n\n{context}"),
            None => args.push(context),
        }
    } else {
        args.extend([FLAG.to_string(), context]);
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_ticket_names_its_tracker() {
        let jira = workspace_context("PM-1234").expect("a Jira key");
        assert!(jira.contains("Jira ticket PM-1234"));
        let pylon = workspace_context("#1234").expect("a Pylon key");
        assert!(pylon.contains("Pylon ticket #1234"));
    }

    #[test]
    fn sessions_and_scheduled_runs_get_nothing() {
        assert!(workspace_context("6123500a-145e-4f84-ba21-b6c1596a4ee4").is_none());
        assert!(workspace_context("sched:abc").is_none());
        let args = strings(&["--model", "opus"]);
        assert_eq!(with_context(args.clone(), "sched:abc"), args);
    }

    #[test]
    fn it_goes_in_the_system_prompt() {
        let args = with_context(strings(&["--model", "opus"]), "PM-1234");
        assert_eq!(args[..3], strings(&["--model", "opus", FLAG])[..]);
        assert!(args[3].contains("Jira ticket PM-1234"));
    }

    #[test]
    fn the_users_own_system_prompt_is_kept() {
        let args = with_context(strings(&[FLAG, "Be terse.", "--verbose"]), "#7");
        assert_eq!(args.iter().filter(|a| *a == FLAG).count(), 1);
        assert!(args[1].starts_with("Be terse.\n\n"));
        assert!(args[1].contains("Pylon ticket #7"));
        assert_eq!(args[2], "--verbose");
    }

    #[test]
    fn an_inline_system_prompt_is_kept_too() {
        let args = with_context(strings(&["--append-system-prompt=Be terse."]), "PM-1");
        assert_eq!(args.len(), 1);
        assert!(args[0].starts_with("--append-system-prompt=Be terse.\n\n"));
        assert!(args[0].contains("Jira ticket PM-1"));
    }
}
