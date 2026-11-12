//! Building a tool's arguments from its advertised input schema, for MCP
//! servers that document tool names but not argument shapes (Atlassian's and
//! Pylon's). Shared by the MCP issue providers (`jira_mcp`, `pylon_mcp`).
//!
//! Each [`Arg`] lists the names (and value shapes) a server might use,
//! preferred first; [`shape`] sends the first one the tool's schema lists,
//! its value coerced to the schema's type. A naming difference between what
//! an adapter guessed and what the server says then doesn't break the call.

use serde_json::{Map, Value};

/// One argument: the names (and value shapes) a server might call it,
/// preferred first.
pub struct Arg {
    alts: Vec<(&'static str, Value)>,
    /// Sent even when the schema doesn't list it: the call means nothing without it.
    always: bool,
}

impl Arg {
    /// Always sent, under the first of `alts` the schema lists (else the first).
    pub fn must(alts: Vec<(&'static str, Value)>) -> Self {
        Self { alts, always: true }
    }

    /// Always sent, under `name`.
    pub fn need(name: &'static str, value: Value) -> Self {
        Self::must(vec![(name, value)])
    }

    /// Sent when the schema lists one of its names, or has no `properties` at all.
    pub fn opt(alts: Vec<(&'static str, Value)>) -> Self {
        Self {
            alts,
            always: false,
        }
    }
}

/// A tool's arguments from `args`, shaped by its input `schema` (None, or one
/// without `properties`: everything goes under its first name, as given).
pub fn shape(schema: Option<&Value>, args: Vec<Arg>) -> Value {
    let props = schema
        .and_then(|s| s.get("properties"))
        .and_then(Value::as_object);
    let mut out = Map::new();
    for arg in args {
        let listed = props.and_then(|p| arg.alts.iter().find(|(k, _)| p.contains_key(*k)));
        let chosen = match (listed, props) {
            (Some(alt), _) => Some(alt),
            // The schema says nothing: send everything as first named.
            (None, None) => arg.alts.first(),
            (None, Some(_)) if arg.always => arg.alts.first(),
            (None, Some(_)) => None,
        };
        if let Some((key, value)) = chosen {
            let ty = props
                .and_then(|p| p.get(*key))
                .and_then(|s| s.get("type"))
                .and_then(Value::as_str);
            out.insert(key.to_string(), coerce(value.clone(), ty));
        }
    }
    Value::Object(out)
}

/// Whether `schema` lists any of `names` as a property.
pub fn lists(schema: Option<&Value>, names: &[&str]) -> bool {
    let props = schema
        .and_then(|s| s.get("properties"))
        .and_then(Value::as_object);
    props.is_some_and(|p| names.iter().any(|n| p.contains_key(*n)))
}

/// `value` in the JSON type the schema asks for, where one converts to the
/// other (a numeric id sent as a number, a field list as a CSV string, an
/// object as the JSON text a `*_json` string argument wants).
fn coerce(value: Value, ty: Option<&str>) -> Value {
    match (ty, value) {
        (Some("integer" | "number"), Value::String(s)) => match s.trim().parse::<i64>() {
            Ok(n) => Value::from(n),
            Err(_) => Value::String(s),
        },
        (Some("string"), Value::Number(n)) => Value::String(n.to_string()),
        (Some("string"), Value::Array(items)) => {
            let parts: Vec<String> = items
                .iter()
                .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string))
                .collect();
            Value::String(parts.join(","))
        }
        (Some("string"), Value::Object(o)) => Value::String(Value::Object(o).to_string()),
        (Some("array"), v @ Value::Object(_)) => Value::Array(vec![v]),
        (Some("array"), Value::String(s)) => {
            Value::Array(s.split(',').map(|p| Value::from(p.trim())).collect())
        }
        (Some("object"), Value::String(s)) => match serde_json::from_str::<Value>(&s) {
            Ok(v @ Value::Object(_)) => v,
            _ => Value::String(s),
        },
        (_, value) => value,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn names_and_types_follow_the_schema() {
        let schema = json!({ "properties": { "board_id": { "type": "integer" },
                                             "fields": { "type": "string" } } });
        let args = shape(
            Some(&schema),
            vec![
                Arg::must(vec![("boardId", json!("42")), ("board_id", json!("42"))]),
                Arg::opt(vec![("fields", json!(["summary", "status"]))]),
                Arg::opt(vec![("maxResults", json!(50))]),
                Arg::need("cloudId", json!("c1")),
            ],
        );
        assert_eq!(
            args,
            json!({ "board_id": 42, "fields": "summary,status", "cloudId": "c1" })
        );
    }

    #[test]
    fn objects_become_json_text_for_a_string_and_back() {
        let schema = json!({ "properties": { "filter_json": { "type": "string" },
                                             "sort": { "type": "object" } } });
        let args = shape(
            Some(&schema),
            vec![
                Arg::opt(vec![("filter_json", json!({ "field": "state" }))]),
                Arg::opt(vec![("sort", json!(r#"{"order":"desc"}"#))]),
            ],
        );
        assert_eq!(args["filter_json"], r#"{"field":"state"}"#);
        assert_eq!(args["sort"], json!({ "order": "desc" }));
    }

    #[test]
    fn without_a_schema_everything_goes_under_its_first_name() {
        let args = shape(None, vec![Arg::opt(vec![("a", json!(1)), ("b", json!(2))])]);
        assert_eq!(args, json!({ "a": 1 }));
        assert!(!lists(None, &["a"]));
        assert!(lists(
            Some(&json!({ "properties": { "b": {} } })),
            &["a", "b"]
        ));
    }
}
