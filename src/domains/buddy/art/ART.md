# Buddy art contract

The buddy's look is **pure data**: each character is a folder here holding a sprite sheet and a
manifest. Changing the art never touches code — overwrite a folder's `sheet.png` +
`manifest.json`, or add a new folder: it's discovered at build time and offered in
Settings → Buddy → Character (`DEFAULT_SPRITE` in `../characters.ts` picks the default).

The character's `name` is also what the buddy calls itself when it speaks.

Validate before handing art back:

```bash
npm run check:sprite              # every folder under src/domains/buddy/art/
npm run check:sprite -- biscuit   # one character
```

## Files

```
art/<character>/
├── sheet.png       # the sprite sheet (required, exactly this name)
└── manifest.json   # how to slice + animate it (required, exactly this name)
```

## sheet.png

- **Every frame is exactly 128×128 px.** That's the standard for all characters.
- PNG with an **alpha channel**; the background must be fully transparent.
- A grid of frames, left→right then top→bottom. Frame `i` sits at column `i % columns`, row
  `floor(i / columns)`. Unused trailing cells may be empty.
- Sheet width **must equal** `columns × 128`; height must be a whole number of 128px rows
  (e.g. 8 columns × 2 rows = 1024×256).
- The app draws each frame at **64pt**, which on a Retina (2×) Mac is exactly 128 device pixels —
  your pixels land 1:1, so draw at full 128px detail; nothing is upscaled. (A 1× monitor gets a
  smooth half-size downscale.) Hard-edged pixel art and smooth illustration both work.
- Fill the frame: the character should span most of the 128px box, with a few px of margin.
- The app has light **and** dark themes: give the character a dark outline so it reads on both.
- Keep effects (`!`, `z`, hearts, sweat) **inside the frame** — anything outside is clipped.
- The buddy sits in a narrow rail and pokes a few px past its right edge — small features should
  still read at 64pt.

## manifest.json

```jsonc
{
  "version": 2,                     // contract version; currently 2 (v1's 24px + "scale" is retired)
  "name": "Critter",                // display name — shown under its tile in Settings
  "frameWidth": 128,                // must be 128
  "frameHeight": 128,               // must be 128
  "columns": 8,                     // frames per sheet row
  "animations": {
    "idle":     { "frames": [0, 0, 0, 1, 0, 2], "fps": 2 },
    "working":  { "frames": [3, 4], "fps": 6 }
    // …one entry per animation below
  }
}
```

There is no `scale` — the app owns the on-screen size. A frame index may repeat (that's how
`idle` holds still between blinks).

### Required animations (one per mood)

| Name       | When it plays                                            | Feel                          |
|------------|----------------------------------------------------------|-------------------------------|
| `idle`     | Nothing notable happening                                | Calm; mostly still, blinks    |
| `working`  | One or more agents are busy                              | Focused, busy (typing, tools) |
| `alert`    | An agent needs the user (permission prompt, waiting)     | Attention-grabbing, `!`       |
| `happy`    | Something good just landed (PR merged, CI green)         | Bouncy, celebratory, brief    |
| `worried`  | Something broke (CI failed, scheduled run failed)        | Anxious, sweat drop           |
| `sleeping` | Nothing has happened for a while                         | Eyes closed, `z`              |

### Optional animations

| Name   | When it plays                               |
|--------|---------------------------------------------|
| `pet`  | The pointer is hovering the buddy           |
| `talk` | A speech bubble is showing (mouth moving)   |

Missing optional animations fall back to the current mood's animation.

Each animation: `frames` (non-empty array of frame indices that exist on the sheet) and `fps`
(1–24). All animations loop.
