import { useState } from "react";
import { type LoadedSprite, listBrokenCharacters, listSprites, resolveSprite } from "./characters";
import { Sprite } from "./Sprite";
import { useBuddyStore } from "./store";

// Settings' character chooser: one live, animated tile per valid art folder,
// however many there are. Hovering a tile previews its "happy" animation.
export function CharacterPicker() {
  const character = useBuddyStore((s) => s.character);
  const setCharacter = useBuddyStore((s) => s.setCharacter);
  const sprites = listSprites();
  const broken = listBrokenCharacters();
  // The stored id may be gone (folder removed) — highlight what's actually shown.
  const activeId = resolveSprite(character)?.id;

  return (
    <div className="buddy-picker">
      <div className="buddy-picker-grid">
        {sprites.map((s) => (
          <CharacterTile
            key={s.id}
            sprite={s}
            selected={s.id === activeId}
            onPick={() => setCharacter(s.id)}
          />
        ))}
      </div>
      {broken.length > 0 && (
        <div className="hint buddy-picker-broken">
          Skipped (breaks the art contract — run <code>npm run check:sprite</code>):{" "}
          {broken.map((b) => `${b.id} (${b.errors.length})`).join(", ")}
        </div>
      )}
    </div>
  );
}

interface CharacterTileProps {
  sprite: LoadedSprite;
  selected: boolean;
  onPick: () => void;
}

function CharacterTile({ sprite, selected, onPick }: CharacterTileProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`buddy-tile${selected ? " selected" : ""}`}
      onClick={onPick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={sprite.manifest.name}
    >
      <Sprite sprite={sprite} animation={hover ? "happy" : "idle"} label={sprite.manifest.name} />
      <span className="name">{sprite.manifest.name}</span>
    </button>
  );
}
