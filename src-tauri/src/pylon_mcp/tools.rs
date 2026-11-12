//! Every Pylon MCP tool the board calls, and how its arguments are built: the
//! one place that knows tool names and argument shapes.
//!
//! **The argument shapes are guessed.** Pylon documents its MCP tools' names
//! (and that `search_issues` pages with `cursor` / `has_next_page` and takes a
//! `filter_json`) but not their input schemas. So every argument lists the
//! names a server might use, REST's first (`state`, `body_html`, `cursor`,
//! `limit`), and `mcp_client::args` sends the one the tool's advertised
//! schema lists, coerced to its type. Pylon lists every tool flat (no
//! discover/execute front), so a tool not listed doesn't exist.
//!
//! `send_issue_reply` is deliberately absent: it writes to the customer and
//! can't be unsent. trace only ever posts internal notes.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::mcp_client::args::{self, Arg};
use crate::mcp_client::ToolInfo;

/// One thing the board does, and the tool that does it.
pub struct Op {
    pub name: &'static str,
    /// The board can't work without it: checked on connect.
    pub required: bool,
}

const fn op(name: &'static str, required: bool) -> Op {
    Op { name, required }
}

pub const ME: Op = op("get_me", true);
pub const SEARCH: Op = op("search_issues", true);
pub const ISSUE: Op = op("get_issue", true);
pub const UPDATE: Op = op("update_issue", true);
/// An internal note: never a reply to the customer.
pub const NOTE: Op = op("send_issue_note", true);
pub const MESSAGES: Op = op("get_issue_messages", true);
/// Optional: the organisation's statuses, custom ones included. Without it,
/// custom statuses are discovered on the issues, as on REST.
pub const STATUSES: Op = op("get_issue_statuses", false);
/// Optional: names for assignees the issue payload gives only an id or email for.
pub const USERS: Op = op("search_users", false);

/// Every op, for the connect check.
pub const ALL: &[&Op] = &[
    &ME, &SEARCH, &ISSUE, &UPDATE, &NOTE, &MESSAGES, &STATUSES, &USERS,
];

/// The tool that writes to the customer. Never called; named so a test can
/// assert that.
#[cfg(test)]
pub const CUSTOMER_REPLY: &str = "send_issue_reply";

/// The issue argument for a card key (`#123`) or id: the number (or id)
/// without the `#`, under whichever name the tool lists. Pylon's tools take
/// "an id or number" in one argument, as its REST API does.
pub fn issue_arg(key: &str) -> Arg {
    let id = key.trim_start_matches('#');
    Arg::must(vec![
        ("issue_id", json!(id)),
        ("id", json!(id)),
        ("issue_id_or_number", json!(id)),
        ("issue_number", json!(id)),
        ("number", json!(id)),
    ])
}

/// The paging arguments: a page size (when the tool takes one) and the
/// previous page's cursor.
pub fn page_args(limit: usize, cursor: Option<&str>) -> Vec<Arg> {
    let mut out = vec![Arg::opt(vec![
        ("limit", json!(limit)),
        ("page_size", json!(limit)),
    ])];
    if let Some(c) = cursor {
        out.push(Arg::must(vec![
            ("cursor", json!(c)),
            ("next_cursor", json!(c)),
        ]));
    }
    out
}

/// The tools the server offers: their input schemas, by name.
pub struct Toolset {
    schemas: HashMap<String, Value>,
}

impl Toolset {
    /// What `tools/list` said. Err names, in one sentence, the tools the
    /// board needs that the server doesn't offer.
    pub fn from_list(tools: Vec<ToolInfo>) -> Result<Self, String> {
        let schemas: HashMap<String, Value> = tools
            .into_iter()
            .map(|t| (t.name, t.input_schema))
            .collect();
        let missing: Vec<&str> = ALL
            .iter()
            .filter(|op| op.required && !schemas.contains_key(op.name))
            .map(|op| op.name)
            .collect();
        if !missing.is_empty() {
            return Err(format!(
                "Pylon's MCP server doesn't offer {}, which trace's Pylon board needs.",
                missing.join(", ")
            ));
        }
        Ok(Self { schemas })
    }

    /// Whether the server offers `op`.
    pub fn offers(&self, op: &Op) -> bool {
        self.schemas.contains_key(op.name)
    }

    /// The input schema of `op`'s tool.
    pub fn schema(&self, op: &Op) -> Option<&Value> {
        self.schemas.get(op.name)
    }

    /// `op`'s arguments from `args`, shaped by its advertised schema.
    pub fn args(&self, op: &Op, args: Vec<Arg>) -> Value {
        args::shape(self.schema(op), args)
    }
}
