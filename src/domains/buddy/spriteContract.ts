// The buddy art contract (see art/ART.md), as code. Shared by the app (which
// refuses a bad manifest rather than rendering garbage) and `npm run
// check:sprite` (which a graphics agent runs before handing art back) — so the
// two can never disagree. Dependency-free and erasable-syntax-only so Node can
// run it straight from the .ts file.

export const MOODS = ["idle", "working", "alert", "happy", "worried", "sleeping"] as const;
export type Mood = (typeof MOODS)[number];

export const OPTIONAL_ANIMATIONS = ["pet", "talk"] as const;
export type AnimationName = Mood | (typeof OPTIONAL_ANIMATIONS)[number];

/** Contract version. v1 (small frames + an integer `scale`) is retired. */
export const CONTRACT_VERSION = 2;

/** Every frame is exactly this many pixels square. */
export const FRAME_PX = 128;

/**
 * On-screen size in CSS px — half of FRAME_PX, so on a Retina (2×) display each
 * art pixel maps to exactly one device pixel. The app owns this, not the art.
 */
export const DISPLAY_PX = FRAME_PX / 2;

export interface SpriteAnimation {
  frames: number[];
  fps: number;
}

export interface SpriteManifest {
  version: typeof CONTRACT_VERSION;
  name: string;
  /** Always FRAME_PX; explicit so a manifest documents its own geometry. */
  frameWidth: number;
  frameHeight: number;
  columns: number;
  animations: Record<Mood, SpriteAnimation> &
    Partial<Record<(typeof OPTIONAL_ANIMATIONS)[number], SpriteAnimation>>;
}

export type ManifestCheck =
  | { ok: true; manifest: SpriteManifest }
  | { ok: false; errors: string[] };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * Validate a parsed manifest. With the sheet's pixel size, also checks the
 * grid geometry and that every frame index lands on the sheet.
 */
export function validateManifest(
  raw: unknown,
  sheet?: { width: number; height: number }
): ManifestCheck {
  const errors: string[] = [];
  if (!isObject(raw)) return { ok: false, errors: ["manifest is not a JSON object"] };

  if (raw.version === 1) {
    errors.push(
      `version 1 is retired: frames are now ${FRAME_PX}×${FRAME_PX} with no "scale" (see ART.md)`
    );
  } else if (raw.version !== CONTRACT_VERSION) {
    errors.push(`version must be ${CONTRACT_VERSION} (got ${JSON.stringify(raw.version)})`);
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) errors.push("name must be a string");
  for (const key of ["frameWidth", "frameHeight"]) {
    if (raw[key] !== FRAME_PX)
      errors.push(`${key} must be ${FRAME_PX} (got ${JSON.stringify(raw[key])})`);
  }
  if (!isPositiveInt(raw.columns)) errors.push("columns must be a positive integer");
  if ("scale" in raw) errors.push(`"scale" is gone in v2 — the app sizes the sprite`);
  const { frameWidth, frameHeight, columns } = raw;

  let frameCount = Number.POSITIVE_INFINITY;
  if (sheet && isPositiveInt(frameWidth) && isPositiveInt(frameHeight) && isPositiveInt(columns)) {
    if (sheet.width !== columns * frameWidth) {
      errors.push(
        `sheet is ${sheet.width}px wide; columns × frameWidth is ${columns * frameWidth}`
      );
    }
    if (sheet.height % frameHeight !== 0) {
      errors.push(`sheet height ${sheet.height} isn't a whole number of ${frameHeight}px rows`);
    }
    frameCount = columns * Math.floor(sheet.height / frameHeight);
  }

  const anims = raw.animations;
  if (!isObject(anims)) {
    errors.push("animations must be an object");
  } else {
    const known = new Set<string>([...MOODS, ...OPTIONAL_ANIMATIONS]);
    for (const name of Object.keys(anims)) {
      if (!known.has(name)) errors.push(`unknown animation "${name}"`);
    }
    for (const mood of MOODS) {
      if (!(mood in anims)) errors.push(`missing required animation "${mood}"`);
    }
    for (const [name, anim] of Object.entries(anims)) {
      if (!isObject(anim)) {
        errors.push(`${name}: must be an object`);
        continue;
      }
      const { frames, fps } = anim;
      if (!Array.isArray(frames) || frames.length === 0) {
        errors.push(`${name}: frames must be a non-empty array`);
      } else {
        for (const f of frames) {
          if (typeof f !== "number" || !Number.isInteger(f) || f < 0) {
            errors.push(`${name}: frame ${JSON.stringify(f)} isn't a non-negative integer`);
          } else if (f >= frameCount) {
            errors.push(`${name}: frame ${f} is off the sheet (${frameCount} cells)`);
          }
        }
      }
      if (typeof fps !== "number" || fps < 1 || fps > 24) errors.push(`${name}: fps must be 1–24`);
    }
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, manifest: raw as unknown as SpriteManifest };
}
