import { invoke } from "@tauri-apps/api/core";

// Notification sounds: macOS's own (`/System/Library/Sounds`), the user's
// (`~/Library/Sounds`), or any audio file they pick. The backend plays them
// with `afplay` — see `commands::sound`.

export interface SoundOption {
  /** Absolute path — also what's stored as the preference. */
  path: string;
  /** File name without extension, for the picker. */
  name: string;
  /** "system" or "you". */
  source: string;
}

export function listNotifySounds(): Promise<SoundOption[]> {
  return invoke("list_notify_sounds");
}

/** Play a sound once. Rejects if the file is gone or isn't playable audio. */
export function playNotifySound(path: string): Promise<void> {
  return invoke("play_notify_sound", { path });
}
