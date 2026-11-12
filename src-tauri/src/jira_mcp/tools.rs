//! Every Atlassian MCP tool the Jira adapter calls, and how its arguments are
//! built: the one place that knows tool names and argument shapes.
//!
//! **The shapes are partly guessed.** Atlassian documents the v2 server's tool
//! names but not their arguments. The names here that v1 also has
//! (`searchJiraIssuesUsingJql`, `getJiraIssue`, `transitionJiraIssue`,
//! `getAccessibleAtlassianResources`) take what v1's schemas say (`cloudId`,
//! `jql`, `fields` as an array, `nextPageToken`, `issueIdOrKey`,
//! `transition: { id }`); the board tools' are guesses. So arguments are built
//! from the server's own advertised input schema where it gives one
//! (`mcp_client::args`, shared with `pylon_mcp`): a naming difference then
//! doesn't break the board.

use std::collections::HashMap;

use serde_json::Value;

use super::route::Route;
use crate::mcp_client::args::{self, Arg};
use crate::mcp_client::ToolInfo;

/// One thing the adapter does, and the tools that do it, preferred first (a
/// v2 name, then the v1 server's name for the same thing).
pub struct Op {
    pub names: &'static [&'static str],
    /// The board can't work without it: checked on connect.
    pub required: bool,
    /// Changes something in Jira (routed through `executeWrite`).
    pub write: bool,
}

const fn read(names: &'static [&'static str], required: bool) -> Op {
    Op {
        names,
        required,
        write: false,
    }
}

pub const SITES: Op = read(&["getAccessibleAtlassianResources"], true);
pub const ME: Op = read(&["getJiraCurrentUser", "atlassianUserInfo"], true);
pub const BOARDS: Op = read(&["listJiraBoards"], true);
pub const BOARD_CONFIG: Op = read(&["getJiraBoardConfig"], true);
pub const SEARCH: Op = read(&["searchJiraIssuesUsingJql"], true);
pub const ISSUE: Op = read(&["getJiraIssue"], true);
pub const TRANSITIONS: Op = read(
    &["listJiraIssueTransitions", "getTransitionsForJiraIssue"],
    true,
);
pub const TRANSITION: Op = Op {
    names: &["transitionJiraIssue"],
    required: true,
    write: true,
};
pub const COMMENT: Op = Op {
    names: &["addOrEditJiraIssueComment", "addCommentToJiraIssue"],
    required: true,
    write: true,
};
/// Optional: the running sprint's name for the header (and `openSprints()`).
pub const SPRINTS: Op = read(&["listJiraBoardSprints"], false);
/// Optional: names for statuses no card is in yet.
pub const STATUSES: Op = read(&["listJiraStatuses"], false);
/// Optional: without it, comments come from `getJiraIssue`'s comment field.
pub const COMMENTS: Op = read(&["listJiraIssueComments"], false);
/// Optional: linked pull requests; none without it.
pub const LINKED: Op = read(&["getTeamworkGraphContext"], false);

/// Every op, for the connect check.
pub const ALL: &[&Op] = &[
    &SITES,
    &ME,
    &BOARDS,
    &BOARD_CONFIG,
    &SEARCH,
    &ISSUE,
    &TRANSITIONS,
    &TRANSITION,
    &COMMENT,
    &SPRINTS,
    &STATUSES,
    &COMMENTS,
    &LINKED,
];

/// The fields a card needs, as the REST adapter asks for them.
pub const CARD_FIELDS: &[&str] = &[
    "summary",
    "status",
    "priority",
    "issuetype",
    "labels",
    "assignee",
    "description",
    "reporter",
    "epic",
    "parent",
];

/// The tools a server offers (their input schemas, by name) and how to reach
/// the ones it doesn't list directly.
pub struct Toolset {
    schemas: HashMap<String, Value>,
    route: Route,
}

impl Toolset {
    /// What `tools/list` said. Err names, in one sentence, the tools the board
    /// needs that the server doesn't offer.
    pub fn from_list(tools: Vec<ToolInfo>) -> Result<Self, String> {
        let route = Route::detect(&tools);
        let schemas: HashMap<String, Value> = tools
            .into_iter()
            .map(|t| (t.name, t.input_schema))
            .collect();
        let set = Self { schemas, route };
        // Behind discover/execute the deferred tools aren't listed: a call
        // that names a missing one fails on its own, with the server's words.
        if set.route == Route::Direct {
            let missing: Vec<&str> = ALL
                .iter()
                .filter(|op| op.required && set.listed(op).is_none())
                .map(|op| op.names[0])
                .collect();
            if !missing.is_empty() {
                return Err(format!(
                    "Atlassian's MCP server doesn't offer {}, which trace's Jira board needs.",
                    missing.join(", ")
                ));
            }
        }
        Ok(set)
    }

    fn listed(&self, op: &Op) -> Option<&'static str> {
        op.names
            .iter()
            .copied()
            .find(|n| self.schemas.contains_key(*n))
    }

    /// The tool that does `op`: one the server lists, else (behind
    /// discover/execute) its preferred name. None: the server can't do it.
    pub fn name(&self, op: &Op) -> Option<&'static str> {
        self.listed(op).or_else(|| match self.route {
            Route::Execute { .. } => op.names.first().copied(),
            Route::Direct => None,
        })
    }

    /// `tool`'s arguments from `args`, shaped by its advertised schema.
    pub fn args(&self, tool: &str, args: Vec<Arg>) -> Value {
        args::shape(self.schemas.get(tool), args)
    }

    /// What to send for a call to `tool`: itself when listed, else through
    /// the server's execute tools. The flag says the result is wrapped.
    pub fn dispatch(&self, tool: &str, args: Value, write: bool) -> (String, Value, bool) {
        if self.schemas.contains_key(tool) {
            return (tool.to_string(), args, false);
        }
        let (name, args) = self.route.wrap(tool, args, write);
        (name, args, true)
    }
}

#[cfg(test)]
#[path = "tools_tests.rs"]
mod tests;
