import { type SpriteManifest, validateManifest } from "./spriteContract";

// Characters are discovered from art/<name>/ at build time (and on the fly in
// dev — Vite re-evaluates the globs when a folder appears), so adding art is a
// drop-in: every valid folder (sheet.png + manifest.json, per art/ART.md) is an
// option in Settings → Buddy. An invalid one is listed as skipped, never rendered.

const manifests = import.meta.glob<unknown>("./art/*/manifest.json", {
  eager: true,
  import: "default",
});
const sheets = import.meta.glob<string>("./art/*/sheet.png", {
  eager: true,
  query: "?url",
  import: "default",
});

/** The character used until the user picks another in Settings. */
export const DEFAULT_SPRITE = "biscuit";

export interface LoadedSprite {
  id: string;
  manifest: SpriteManifest;
  sheetUrl: string;
}

/** A folder under art/ that was skipped, and why — surfaced in Settings. */
export interface BrokenCharacter {
  id: string;
  errors: string[];
}

const BROKEN: BrokenCharacter[] = [];

function load(id: string): LoadedSprite | null {
  const raw = manifests[`./art/${id}/manifest.json`];
  const sheetUrl = sheets[`./art/${id}/sheet.png`];
  if (raw === undefined || !sheetUrl) {
    BROKEN.push({
      id,
      errors: [raw === undefined ? "missing manifest.json" : "missing sheet.png"],
    });
    return null;
  }
  const check = validateManifest(raw);
  if (!check.ok) {
    BROKEN.push({ id, errors: check.errors });
    return null;
  }
  return { id, manifest: check.manifest, sheetUrl };
}

/** Every folder under art/ — a half-delivered one (sheet but no manifest) included. */
// Dedupe by folder, not path: a folder contributes both a manifest and a sheet path.
const FOLDERS = [
  ...new Set([...Object.keys(manifests), ...Object.keys(sheets)].map((p) => p.split("/")[2] ?? "")),
];

const SPRITES: LoadedSprite[] = FOLDERS.map(load)
  .filter((s): s is LoadedSprite => s !== null)
  .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

/** Folders skipped for breaking the art contract (run `npm run check:sprite`). */
export function listBrokenCharacters(): BrokenCharacter[] {
  return BROKEN;
}

/** Every valid character, by display name. */
export function listSprites(): LoadedSprite[] {
  return SPRITES;
}

/** The chosen character, falling back to the default, then to any valid one. */
export function resolveSprite(id: string): LoadedSprite | null {
  return (
    SPRITES.find((s) => s.id === id) ??
    SPRITES.find((s) => s.id === DEFAULT_SPRITE) ??
    SPRITES[0] ??
    null
  );
}
