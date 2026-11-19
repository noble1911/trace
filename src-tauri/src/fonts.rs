//! The font families installed on this machine, for Settings → Appearance's font
//! pickers. The webview can only *test* a family it's given (by measuring text),
//! not list them, so the pickers used to offer a short hard-coded list filtered
//! to what's installed. `fontdb` reads the OS font folders (and fontconfig on
//! Linux), parsing each file's header only, so this is the same on every OS.
//!
//! The scan takes a moment on a machine with many fonts, so it runs once, off the
//! main thread (`commands::fonts`), and is cached for the life of the process.
//! Fonts installed while trace is open show after a restart.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Serialize;

/// Every installed family, split the way the pickers want them: the interface
/// and chat text pickers offer `proportional`, the code and terminal ones
/// `monospace`. Each list is sorted case-insensitively, without duplicates.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledFonts {
    pub proportional: Vec<String>,
    pub monospace: Vec<String>,
}

static CACHE: OnceLock<InstalledFonts> = OnceLock::new();

/// The installed families, scanned on first call and cached after. Blocking:
/// call it from a worker thread.
pub fn installed() -> InstalledFonts {
    CACHE.get_or_init(scan).clone()
}

fn scan() -> InstalledFonts {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    // fontdb puts the English (US) family name first when the font has one.
    classify(db.faces().filter_map(|f| {
        f.families
            .first()
            .map(|(name, _)| (name.as_str(), f.monospaced))
    }))
}

/// Group faces into families and sort them into the two lists. A family is
/// monospace when any of its faces says so, so a family never appears in both.
/// The flag is the font's own (`post.isFixedPitch`), and some monospace fonts
/// don't set it (macOS's Monaco and Courier): the renderer re-measures the
/// proportional list (`appearance/installedFonts.ts`).
/// Hidden system families (macOS names its private UI fonts with a leading `.`
/// or `#`) and `LastResort` (a glyph-of-last-resort font) are left out: typing
/// them would give a confusing result.
pub(crate) fn classify<'a>(faces: impl Iterator<Item = (&'a str, bool)>) -> InstalledFonts {
    // Keyed case-insensitively so "Fira Code" and "fira code" collapse; the
    // first spelling seen is kept.
    let mut families: BTreeMap<String, (String, bool)> = BTreeMap::new();
    for (name, mono) in faces {
        let name = name.trim();
        if name.is_empty() || name.starts_with('.') || name.starts_with('#') || name == "LastResort"
        {
            continue;
        }
        let entry = families
            .entry(name.to_lowercase())
            .or_insert_with(|| (name.to_string(), false));
        entry.1 |= mono;
    }
    let mut out = InstalledFonts::default();
    for (name, mono) in families.into_values() {
        if mono {
            out.monospace.push(name);
        } else {
            out.proportional.push(name);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_sorts_and_dedupes_families() {
        let fonts = classify(
            [
                ("Menlo", true),
                ("Helvetica Neue", false),
                ("arial", false),
                ("Arial", false),
                ("Helvetica Neue", false),
            ]
            .into_iter(),
        );
        assert_eq!(fonts.proportional, ["arial", "Helvetica Neue"]);
        assert_eq!(fonts.monospace, ["Menlo"]);
    }

    #[test]
    fn a_family_with_any_monospaced_face_is_monospace() {
        let fonts = classify([("Iosevka", false), ("Iosevka", true)].into_iter());
        assert!(fonts.proportional.is_empty());
        assert_eq!(fonts.monospace, ["Iosevka"]);
    }

    #[test]
    fn hidden_and_last_resort_families_are_left_out() {
        let fonts = classify(
            [
                (".SF NS", false),
                ("#GungSeo", false),
                ("LastResort", false),
                ("  ", false),
                ("Inter", false),
            ]
            .into_iter(),
        );
        assert_eq!(fonts.proportional, ["Inter"]);
    }

    /// Scans this machine's fonts. Ignored by default (it depends on the OS):
    /// `cargo test fonts_live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn fonts_live() {
        let fonts = installed();
        println!(
            "{} proportional, {} monospace",
            fonts.proportional.len(),
            fonts.monospace.len()
        );
        assert!(!fonts.proportional.is_empty());
    }
}
