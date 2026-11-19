import type { Release } from "../../ipc/update.ts";

// The About tab's changelog rules: comparing versions, which release is the one
// you run and which are newer, and how many to show before "Show older".

/** How many releases older than yours show before "Show older releases". */
export const OLDER_SHOWN = 3;

/** <0 when `a` is older than `b`, 0 when the same, >0 when newer ("0.16.10" > "0.16.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function parts(version: string): number[] {
  const core = version.replace(/^v/, "").split(/[-+]/)[0] ?? "";
  return core.split(".").map((n) => Number.parseInt(n, 10) || 0);
}

export type ReleaseMark = "new" | "installed" | null;

/** "new" for a release newer than the one running, "installed" for that one. */
export function releaseMark(version: string, current: string): ReleaseMark {
  if (!current) return null;
  const d = compareVersions(version, current);
  return d > 0 ? "new" : d === 0 ? "installed" : null;
}

/** Newest first, whatever order GitHub gave them in. */
export function sortReleases(releases: Release[]): Release[] {
  return [...releases].sort((a, b) => compareVersions(b.version, a.version));
}

/** How many of the (sorted) releases show at first: every newer one, yours, and a few before. */
export function initialCount(sorted: Release[], current: string): number {
  const older = sorted.findIndex((r) => current && compareVersions(r.version, current) < 0);
  if (older === -1) return sorted.length;
  return Math.min(sorted.length, older + OLDER_SHOWN);
}

/** "17 Nov 2026"; empty when there's no date. */
export function formatReleaseDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
