import { Switch } from "@/components/Switch";
import { CharacterPicker } from "@/domains/buddy/CharacterPicker";
import { resolveSprite } from "@/domains/buddy/characters";
import { useBuddyStore } from "@/domains/buddy/store";
import { SettingRow } from "./SettingRow";

// The rail buddy: on/off, and which character it wears — a live tile per valid
// folder under domains/buddy/art/ (see ART.md there), however many there are.
export function BuddySettings() {
  const enabled = useBuddyStore((s) => s.enabled);
  const setEnabled = useBuddyStore((s) => s.setEnabled);
  const character = useBuddyStore((s) => s.character);

  return (
    <section className="setting-group">
      <h2>Buddy</h2>
      <div className="desc">
        Your buddy lives above Settings in the rail, reacts to your agents, and comments on what
        happens. Each bubble is one Claude Haiku call through the Assistant connection below (at
        most 40 an hour).
      </div>
      <SettingRow label="Show buddy" hint="Click it to say hi; right-click mutes it for an hour.">
        <Switch on={enabled} onChange={setEnabled} label="Show buddy" />
      </SettingRow>
      {enabled && (
        <>
          <SettingRow
            label="Character"
            hint="Every folder in src/domains/buddy/art/ is an option — see ART.md there."
          >
            <span className="hint">{resolveSprite(character)?.manifest.name ?? "None"}</span>
          </SettingRow>
          <CharacterPicker />
        </>
      )}
    </section>
  );
}
