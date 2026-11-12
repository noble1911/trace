//! Reaching tools the server doesn't list directly.
//!
//! Atlassian's v2 server shows a handful of primary tools and keeps the rest
//! behind `discover` (find a tool) and `executeRead` / `executeWrite` (run
//! one); `?tools=all` lists every tool flat, which is what trace asks for. If
//! a server still answers with the front only, a call to an unlisted tool goes
//! through `executeRead` (or `executeWrite` for a change) instead. The execute
//! tools' argument names aren't documented, so they're read from its schema,
//! with guesses (`toolName`, `arguments`) when it lists none we know.

use serde_json::{json, Value};

use crate::mcp_client::ToolInfo;

const NAME_KEYS: &[&str] = &[
    "toolName",
    "tool_name",
    "tool",
    "name",
    "operation",
    "operationId",
];
const ARGS_KEYS: &[&str] = &[
    "arguments",
    "args",
    "toolArguments",
    "input",
    "params",
    "parameters",
];

/// How a call to an unlisted tool is made.
#[derive(Debug, PartialEq)]
pub enum Route {
    /// Every tool is listed: call them by name. An unlisted one doesn't exist.
    Direct,
    /// Through the execute tools: `read`/`write` are their names, with the
    /// tool's name under `name_key` and its arguments under `args_key`.
    Execute {
        read: String,
        write: String,
        name_key: String,
        args_key: String,
    },
}

fn first_listed(schema: &Value, keys: &[&str]) -> String {
    let props = schema.get("properties").and_then(Value::as_object);
    let listed = props.and_then(|p| keys.iter().find(|k| p.contains_key(**k)));
    listed.unwrap_or(&keys[0]).to_string()
}

impl Route {
    /// Execute when the server lists `executeRead`, Direct otherwise.
    pub fn detect(tools: &[ToolInfo]) -> Self {
        let find = |name: &str| tools.iter().find(|t| t.name == name);
        let Some(exec) = find("executeRead") else {
            return Route::Direct;
        };
        let write = find("executeWrite").map_or("executeRead", |t| t.name.as_str());
        Route::Execute {
            read: exec.name.clone(),
            write: write.to_string(),
            name_key: first_listed(&exec.input_schema, NAME_KEYS),
            args_key: first_listed(&exec.input_schema, ARGS_KEYS),
        }
    }

    /// The tool to call and its arguments, to run `tool` with `args`.
    pub fn wrap(&self, tool: &str, args: Value, write: bool) -> (String, Value) {
        match self {
            Route::Direct => (tool.to_string(), args),
            Route::Execute {
                read,
                write: writer,
                name_key,
                args_key,
            } => {
                let via = if write { writer } else { read };
                let mut wrapped = json!({});
                wrapped[name_key.as_str()] = json!(tool);
                wrapped[args_key.as_str()] = args;
                (via.clone(), wrapped)
            }
        }
    }
}

/// An execute tool's result without its envelope, when it put the tool's
/// result under one key (`result`, `data`, `output`) and nothing else.
pub fn unwrap(value: Value) -> Value {
    let Value::Object(map) = &value else {
        return value;
    };
    if map.len() == 1 {
        for key in ["result", "data", "output"] {
            if let Some(inner) = map.get(key).filter(|v| v.is_object() || v.is_array()) {
                return inner.clone();
            }
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &str, schema: Value) -> ToolInfo {
        ToolInfo {
            name: name.into(),
            description: String::new(),
            input_schema: schema,
        }
    }

    #[test]
    fn a_full_list_is_direct() {
        let tools = vec![tool("listJiraBoards", json!({}))];
        assert_eq!(Route::detect(&tools), Route::Direct);
    }

    #[test]
    fn the_execute_front_names_its_arguments_from_its_schema() {
        let tools = vec![
            tool("discover", json!({})),
            tool(
                "executeRead",
                json!({ "properties": { "tool": {}, "input": {} } }),
            ),
            tool("executeWrite", json!({})),
        ];
        let route = Route::detect(&tools);
        let (via, args) = route.wrap("listJiraBoards", json!({ "cloudId": "c" }), false);
        assert_eq!(via, "executeRead");
        assert_eq!(
            args,
            json!({ "tool": "listJiraBoards", "input": { "cloudId": "c" } })
        );
        let (via, _) = route.wrap("transitionJiraIssue", json!({}), true);
        assert_eq!(via, "executeWrite");
    }

    #[test]
    fn unknown_execute_arguments_fall_back_to_the_guess() {
        let route = Route::detect(&[tool("executeRead", json!({}))]);
        let (via, args) = route.wrap("x", json!({}), true);
        assert_eq!(via, "executeRead", "no executeWrite: read runs it");
        assert_eq!(args, json!({ "toolName": "x", "arguments": {} }));
    }

    #[test]
    fn an_envelope_is_taken_off() {
        assert_eq!(unwrap(json!({ "result": { "a": 1 } })), json!({ "a": 1 }));
        let kept = json!({ "issues": [], "isLast": true });
        assert_eq!(unwrap(kept.clone()), kept);
    }
}
