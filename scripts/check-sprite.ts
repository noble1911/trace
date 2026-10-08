// Validate buddy characters against the art contract (src/domains/buddy/art/ART.md).
// Run: `npm run check:sprite` (all) or `npm run check:sprite -- <character>`.
// Node runs this .ts directly (type stripping), sharing the app's own rules.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest } from "../src/domains/buddy/spriteContract.ts";

const ART_DIR = join(import.meta.dirname, "..", "src", "domains", "buddy", "art");

/** Width, height and alpha support from a PNG's header chunks. */
function pngInfo(bytes: Buffer): { width: number; height: number; hasAlpha: boolean } | null {
  const signature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== signature) return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  // 4 = grey+alpha, 6 = RGBA; 3 = palette, which has alpha only with a tRNS chunk.
  const hasAlpha = colorType === 4 || colorType === 6 || bytes.includes(Buffer.from("tRNS"));
  return { width, height, hasAlpha };
}

function check(character: string): string[] {
  const dir = join(ART_DIR, character);
  const errors: string[] = [];
  const sheetPath = join(dir, "sheet.png");
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(sheetPath)) errors.push("missing sheet.png");
  if (!existsSync(manifestPath)) errors.push("missing manifest.json");
  if (errors.length) return errors;

  const info = pngInfo(readFileSync(sheetPath));
  if (!info) return ["sheet.png is not a PNG"];
  if (!info.hasAlpha) errors.push("sheet.png has no alpha channel (background must be transparent)");

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return [...errors, `manifest.json doesn't parse: ${String(e)}`];
  }
  const result = validateManifest(manifest, info);
  return result.ok ? errors : [...errors, ...result.errors];
}

const requested = process.argv.slice(2);
const characters = requested.length
  ? requested
  : readdirSync(ART_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

let failed = false;
for (const character of characters) {
  const errors = check(character);
  if (errors.length) {
    failed = true;
    console.error(`✗ ${character}`);
    for (const e of errors) console.error(`    ${e}`);
  } else {
    console.log(`✓ ${character}`);
  }
}
process.exit(failed ? 1 : 0);
