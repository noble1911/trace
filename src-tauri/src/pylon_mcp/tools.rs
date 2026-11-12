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
    /// Changes something in Pylon. A read's answer must be JSON trace can
    /// read; a write's is only checked for failure.
    pub write: bool,
}

const fn op(name: &'static str, required: bool) -> Op {
    Op {
        name,
        required,
        write: false,
    }
}

/// Who's signed in: validates the login on connect.
pub const ME: Op = op("get_me", true);
/// The board's cards (the rolling window).
pub const SEARCH: Op = op("search_issues", true);
/// One issue: its state.
pub const ISSUE: Op = op("get_issue", true);
/// Moving a card (setting its state).
pub const UPDATE: Op = Op {
    name: "update_issue",
    required: true,
    write: true,
};
/// An internal note: never a reply to the customer.
pub const NOTE: Op = Op {
    name: "send_issue_note",
    required: true,
    write: true,
};
/// An issue's thread, for an agent's brief.
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

/// Arguments that take an issue's number.
const NUMBER_ARGS: &[&str] = &["issue_number", "number", "issue_id_or_number"];
/// Arguments that take an issue's id (Pylon's take "an id or number").
const ID_ARGS: &[&str] = &["issue_id", "id"];

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

    /// The issue argument for `key` on `op`'s tool. A card key (`#123`) is a
    /// number: under a number argument when the tool lists one, else under
    /// its id argument, which Pylon's tools take "an id or number" in, as its
    /// REST API does, unless the schema says that argument is a UUID (Err:
    /// a number can't go there, and trace has no id for a bare key). An id
    /// goes under the id argument.
    pub fn issue_arg(&self, op: &Op, key: &str) -> Result<Arg, String> {
        let props = self
            .schema(op)
            .and_then(|s| s.get("properties"))
            .and_then(Value::as_object);
        let Some(number) = key.strip_prefix('#') else {
            let mut alts: Vec<&'static str> = ID_ARGS.to_vec();
            alts.extend(NUMBER_ARGS);
            return Ok(Arg::must(alts.iter().map(|n| (*n, json!(key))).collect()));
        };
        let listed = |names: &[&'static str]| {
            names
                .iter()
                .copied()
                .find(|n| props.is_some_and(|p| p.contains_key(*n)))
        };
        if let Some(name) = listed(NUMBER_ARGS) {
            return Ok(Arg::need(name, json!(number)));
        }
        let id_arg = listed(ID_ARGS);
        let is_uuid = id_arg
            .and_then(|n| props?.get(n)?.get("format")?.as_str())
            .is_some_and(|f| f.eq_ignore_ascii_case("uuid"));
        if is_uuid {
            return Err(format!(
                "Pylon's {} takes an issue's id, not its number, so trace can't act on {key}.",
                op.name
            ));
        }
        let mut alts: Vec<&'static str> = ID_ARGS.to_vec();
        alts.extend(NUMBER_ARGS);
        Ok(Arg::must(
            alts.iter().map(|n| (*n, json!(number))).collect(),
        ))
    }
}
