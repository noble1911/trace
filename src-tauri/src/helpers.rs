//! Small shared helpers used across modules.

use chrono::Utc;
use uuid::Uuid;

/// Current time as an RFC3339 string.
pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

/// A fresh random id.
pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

/// Lowercase, hyphenated slug suitable for branch names.
pub fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}
