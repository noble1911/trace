//! Images inside an agent's chat reply (`![Preview](/abs/path.png)`), served
//! over the Gallery's `trace-img` protocol so they load the way its sets do. The
//! webview can't load a local path or `file://` itself, which is what made them
//! draw as a broken "?" box.
//!
//! No set to be inside: any image file the user can read, under the same checks
//! as a set's (`contain::image_file`: absolute, canonicalised, an image by its
//! real name, the size cap) and only for trace's own webview (`protocol`). That
//! is no wider than `show_images`, which can already show any folder.
//!
//! The renderer resolves a relative path against the workspace and a `file://`
//! URL to its path; here `~/` is expanded, and a path written percent-encoded
//! (`My%20File.png`, as Markdown links often are) is tried decoded when the
//! literal name isn't there.

use std::path::PathBuf;

use super::contain;

/// The image file an agent's reply names, or why it can't be shown.
pub fn file(requested: &str) -> Result<PathBuf, String> {
    let expanded = expand_home(requested);
    match contain::image_file(&expanded) {
        Err(why) if expanded.contains('%') => match percent_decoded(&expanded) {
            Some(decoded) => contain::image_file(&decoded).map_err(|_| why),
            None => Err(why),
        },
        found => found,
    }
}

/// `~` or `~/…` from the home directory; anything else as it is.
fn expand_home(path: &str) -> String {
    let rest = match path.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with(['/', '\\']) => rest,
        _ => return path.to_string(),
    };
    match dirs::home_dir() {
        Some(home) => format!("{}{rest}", home.to_string_lossy()),
        None => path.to_string(),
    }
}

/// `%XX` escapes decoded, when they make valid UTF-8; None if there were none
/// or they don't.
fn percent_decoded(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    let mut changed = false;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok());
        match (bytes[i], hex.and_then(|h| u8::from_str_radix(h, 16).ok())) {
            (b'%', Some(byte)) => {
                out.push(byte);
                changed = true;
                i += 3;
            }
            (b, _) => {
                out.push(b);
                i += 1;
            }
        }
    }
    changed.then(|| String::from_utf8(out).ok()).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gallery::scan::tests::Scratch;

    fn s(p: &std::path::Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn serves_an_image_by_its_path_spaces_and_escapes_too() {
        let dir = Scratch::new("inline");
        let spaced = dir.file("previews/My File.png", b"x");
        let txt = dir.file("previews/notes.txt", b"x");
        let canon = std::fs::canonicalize(&spaced).expect("canon");
        assert_eq!(file(&s(&spaced)), Ok(canon.clone()));
        let escaped = s(&spaced).replace(' ', "%20");
        assert_eq!(file(&escaped), Ok(canon));
        assert_eq!(file(&s(&txt)).unwrap_err(), "Not an image.");
        assert_eq!(
            file("previews/My File.png").unwrap_err(),
            "Not an absolute path."
        );
        assert_eq!(
            file(&s(&dir.0.join("gone.png"))).unwrap_err(),
            "No such file."
        );
    }

    #[test]
    fn decoding_and_home() {
        assert_eq!(
            percent_decoded("/a/My%20File.png").as_deref(),
            Some("/a/My File.png")
        );
        assert_eq!(percent_decoded("/a/b.png"), None);
        assert_eq!(percent_decoded("/a/100%.png"), None);
        assert_eq!(percent_decoded("/a/%zz.png"), None);
        assert_eq!(
            percent_decoded("/a/%C3%A9.png").as_deref(),
            Some("/a/é.png")
        );
        assert_eq!(expand_home("/abs/x.png"), "/abs/x.png");
        assert_eq!(expand_home("~user/x.png"), "~user/x.png");
        if let Some(home) = dirs::home_dir() {
            assert_eq!(
                expand_home("~/x.png"),
                format!("{}/x.png", home.to_string_lossy())
            );
        }
    }
}
