import { useMemo } from "react";
import { resolveSprite } from "./characters";
import { useBuddyBrain } from "./hooks/useBuddyBrain";
import { useBuddyMood } from "./hooks/useBuddyMood";
import { SpeechBubble } from "./SpeechBubble";
import { Sprite } from "./Sprite";
import type { AnimationName, Mood } from "./spriteContract";
import { useBuddyStore } from "./store";

const MUTE_MS = 3_600_000;

/** Moods that matter more than the mouth moving. */
const PRESSING = new Set<Mood>(["alert", "worried"]);

// The rail buddy: a pixel character that reacts to the board (mood → animation)
// and comments on activity in a speech bubble. Click to poke it, hover to pet
// it, right-click to mute it for an hour. Rendered only while enabled.
export function Buddy() {
  const character = useBuddyStore((s) => s.character);
  const petting = useBuddyStore((s) => s.petting);
  const talking = useBuddyStore((s) => s.bubble !== null);
  const mutedUntil = useBuddyStore((s) => s.mutedUntil);
  const setPetting = useBuddyStore((s) => s.setPetting);
  const toggleMute = useBuddyStore((s) => s.toggleMute);
  const sprite = useMemo(() => resolveSprite(character), [character]);
  const mood = useBuddyMood();
  const name = sprite?.manifest.name ?? "Buddy";
  const { poke } = useBuddyBrain({ name, personality: sprite?.manifest.personality });

  if (!sprite) return null;
  const has = (name: AnimationName) => sprite.manifest.animations[name] !== undefined;
  const animation: AnimationName =
    petting && has("pet") ? "pet" : !PRESSING.has(mood) && talking && has("talk") ? "talk" : mood;
  const muted = mutedUntil > Date.now();

  return (
    <div className={`buddy${muted ? " muted" : ""}`}>
      <button
        type="button"
        className="buddy-btn"
        title={
          muted
            ? `${name} is muted — right-click to unmute`
            : `${name} — click to say hi, right-click to mute for an hour`
        }
        onClick={poke}
        onContextMenu={(e) => {
          e.preventDefault();
          toggleMute(MUTE_MS);
        }}
        onMouseEnter={() => setPetting(true)}
        onMouseLeave={() => setPetting(false)}
      >
        <Sprite sprite={sprite} animation={animation} label={`${name} (${mood})`} />
      </button>
      <SpeechBubble />
    </div>
  );
}
