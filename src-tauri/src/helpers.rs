//! Small shared helpers used across modules.

use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

/// Restrict a config file to user-only access (0600). Everything we persist
/// under the config dir goes through this — session ids and repo paths aren't
/// token-grade secrets, but a world-readable session id still lets another
/// local user resume the conversation.
#[cfg(unix)]
pub fn restrict_perms(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
pub fn restrict_perms(_path: &Path) {}

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

#[cfg(test)]
mod tests {
    use super::slugify;

    #[test]
    fn slugify_issue_keys_and_edges() {
        assert_eq!(slugify("TRACE-12"), "trace-12");
        assert_eq!(slugify("My Feature!!"), "my-feature");
        assert_eq!(slugify("--weird  input--"), "weird-input");
        assert_eq!(slugify("héllo wörld"), "h-llo-w-rld");
        assert_eq!(slugify(""), "");
        assert_eq!(slugify("!!!"), "");
    }
}
