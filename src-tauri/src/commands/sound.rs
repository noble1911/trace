//! The sound that plays when an agent wants you (off by default).
//!
//! macOS already ships well-made alert sounds in `/System/Library/Sounds`, and
//! keeps the user's own in `~/Library/Sounds` — so trace offers those rather
//! than bundling audio of its own, and will play any file the user picks
//! instead. Playback is `afplay`, the system player, so every CoreAudio format
//! works (aiff/wav/mp3/m4a/caf) with nothing to decode in the renderer.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// Where macOS keeps alert sounds: the system set, then the user's own.
const SOUND_DIRS: [&str; 2] = ["/System/Library/Sounds", "~/Library/Sounds"];

/// What `afplay` will take. Also the guard on a user-picked file — trace hands
/// the path to a player, so it should be audio and nothing else.
const AUDIO_EXTENSIONS: [&str; 7] = ["aiff", "aif", "wav", "mp3", "m4a", "caf", "aac"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundOption {
    /// Absolute path — also the stored preference, so a custom file is just
    /// another option.
    pub path: String,
    /// The file's name without extension ("Glass"), for the picker.
    pub name: String,
    /// "system" or "you" — where it came from.
    pub source: String,
}

fn expand(dir: &str) -> Option<PathBuf> {
    match dir.strip_prefix("~/") {
        Some(rest) => dirs::home_dir().map(|home| home.join(rest)),
        None => Some(PathBuf::from(dir)),
    }
}

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .is_some_and(|e| AUDIO_EXTENSIONS.contains(&e.as_str()))
}

/// Sounds to choose from: macOS's, then the user's own, each alphabetical.
#[tauri::command]
pub fn list_notify_sounds() -> Vec<SoundOption> {
    let mut out = Vec::new();
    for dir in SOUND_DIRS {
        let Some(path) = expand(dir) else { continue };
        let source = if dir.starts_with('~') { "you" } else { "system" };
        let Ok(entries) = std::fs::read_dir(&path) else { continue };
        let mut found: Vec<SoundOption> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_file() && is_audio(p))
            .filter_map(|p| {
                Some(SoundOption {
                    name: p.file_stem()?.to_string_lossy().to_string(),
                    path: p.to_string_lossy().to_string(),
                    source: source.to_string(),
                })
            })
            .collect();
        found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out.extend(found);
    }
    out
}

/// Play `path` once, without waiting for it: a notification sound must never
/// hold up the caller. Rejects anything that isn't an existing audio file.
#[tauri::command]
pub fn play_notify_sound(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err("That sound file no longer exists.".to_string());
    }
    if !is_audio(&file) {
        return Err(format!("{} isn't an audio file trace can play.", path));
    }
    let mut child = Command::new("afplay")
        .arg(&file)
        .spawn()
        .map_err(|e| format!("Couldn't play the sound: {e}"))?;
    // Reap it off-thread — an unwaited child lingers as a zombie, and a sound
    // plays for a second or two.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_audio, list_notify_sounds};
    use std::path::Path;

    #[test]
    fn only_audio_files_count() {
        assert!(is_audio(Path::new("/System/Library/Sounds/Glass.aiff")));
        assert!(is_audio(Path::new("/tmp/My Sound.WAV")));
        assert!(!is_audio(Path::new("/tmp/notes.txt")));
        assert!(!is_audio(Path::new("/tmp/noextension")));
    }

    #[test]
    fn macos_ships_sounds_to_offer() {
        // Every Mac has these; the listing is what fills the Settings picker.
        let sounds = list_notify_sounds();
        assert!(sounds.iter().any(|s| s.name == "Glass" && s.source == "system"));
        assert!(sounds.iter().all(|s| s.path.ends_with(".aiff")
            || s.path.ends_with(".wav")
            || s.path.ends_with(".mp3")
            || s.path.ends_with(".m4a")
            || s.path.ends_with(".caf")
            || s.path.ends_with(".aac")
            || s.path.ends_with(".aif")));
    }
}
