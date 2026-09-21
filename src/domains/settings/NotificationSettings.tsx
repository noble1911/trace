import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { Switch } from "@/components/Switch";
import {
  notifyOnWaiting,
  notifySoundOn,
  notifySoundPath,
  setNotifyOnWaiting,
  setNotifySoundOn,
  setNotifySoundPath,
} from "@/domains/agent/defaults";
import { listNotifySounds, playNotifySound, type SoundOption } from "@/ipc/sound";
import { SettingRow } from "./SettingRow";

/** Audio formats `afplay` handles — the filter on the "choose a file" dialog. */
const AUDIO_EXTENSIONS = ["aiff", "aif", "wav", "mp3", "m4a", "caf", "aac"];

/** What to play the first time someone turns the sound on. */
function firstChoice(options: SoundOption[]): string {
  const glass = options.find((o) => o.name === "Glass");
  return (glass ?? options[0])?.path ?? "";
}

const fileName = (path: string) => path.split("/").pop() ?? path;

// The Notifications section of Settings: how trace gets your attention when an
// agent needs you. The sound is off by default and plays whenever you're pinged,
// whether or not the native notification is on.
export function NotificationSettings() {
  const [notifyWaiting, setNotifyWaiting] = useState(notifyOnWaiting);
  const [soundOn, setSoundOn] = useState(notifySoundOn);
  const [sound, setSound] = useState(notifySoundPath);
  const [options, setOptions] = useState<SoundOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listNotifySounds()
      .then((all) => {
        if (!cancelled) setOptions(all);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseNotifyWaiting = (next: boolean) => {
    setNotifyWaiting(next);
    setNotifyOnWaiting(next);
  };

  // Play what was just chosen, so the picker is also the preview.
  const preview = (path: string) => {
    if (!path) return;
    setError(null);
    void playNotifySound(path).catch((err) => setError(String(err)));
  };

  const chooseSound = (path: string) => {
    setSound(path);
    setNotifySoundPath(path);
    preview(path);
  };

  const toggleSound = (next: boolean) => {
    setSoundOn(next);
    setNotifySoundOn(next);
    if (!next) return;
    // First time on: start from a sound that exists rather than silence.
    const path = sound || firstChoice(options);
    if (path !== sound) {
      setSound(path);
      setNotifySoundPath(path);
    }
    preview(path);
  };

  const pickFile = async () => {
    const picked = await open({
      multiple: false,
      title: "Choose a notification sound",
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (typeof picked === "string") chooseSound(picked);
  };

  const mine = options.filter((o) => o.source === "you");
  const system = options.filter((o) => o.source !== "you");
  // A file picked from elsewhere isn't in either folder — keep it listed.
  const custom = sound && !options.some((o) => o.path === sound) ? sound : null;

  return (
    <section className="setting-group">
      <h2>Notifications</h2>
      <div className="desc">How trace gets your attention outside the app.</div>
      <SettingRow
        label="When an agent needs me"
        hint="Native notification when a session finishes its turn while you're elsewhere."
      >
        <Switch on={notifyWaiting} onChange={chooseNotifyWaiting} label="Notify when waiting" />
      </SettingRow>
      <SettingRow
        label="Play a sound"
        hint="Sounds at the same moments — a permission prompt, or a finished turn you're not watching."
      >
        <Switch on={soundOn} onChange={toggleSound} label="Play a sound when an agent needs you" />
      </SettingRow>
      {soundOn && (
        <SettingRow label="Sound" hint="Picking one plays it.">
          <div className="sound-picker">
            <select
              aria-label="Notification sound"
              value={sound}
              onChange={(e) => chooseSound(e.target.value)}
            >
              {custom && (
                <optgroup label="Chosen file">
                  <option value={custom}>{fileName(custom)}</option>
                </optgroup>
              )}
              {mine.length > 0 && (
                <optgroup label="Your sounds">
                  {mine.map((o) => (
                    <option key={o.path} value={o.path}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="macOS">
                {system.map((o) => (
                  <option key={o.path} value={o.path}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <button type="button" className="btn" onClick={() => preview(sound)}>
              Play
            </button>
            <button type="button" className="btn ghost" onClick={() => void pickFile()}>
              Choose a file…
            </button>
          </div>
        </SettingRow>
      )}
      {error && <div className="setting-note error">{error}</div>}
    </section>
  );
}
