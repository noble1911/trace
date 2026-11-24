import type { Installed, Installs } from "@/ipc/skills";

// Where one plugin can be installed, and where it is: everywhere for you, then each of
// trace's repositories. A repository whose default branch already enables the plugin
// has it for everyone, so it isn't offered again there.

export type Place =
  | { kind: "you"; installed: Installed | null }
  | { kind: "repo"; repo: string; committed: boolean; installed: Installed | null };

/** Every place plugin `id` can go, with what's there now. */
export function placesFor(id: string, installs: Installs): Place[] {
  const mine = installs.user.find((i) => i.id === id) ?? null;
  return [
    { kind: "you", installed: mine },
    ...installs.projects.map(
      (p): Place => ({
        kind: "repo",
        repo: p.repo,
        committed: p.committed.includes(id),
        installed: p.installed.find((i) => i.id === id) ?? null,
      })
    ),
  ];
}

/** A card's one-line "where it's installed", or null when it's nowhere. */
export function placesSummary(places: Place[]): string | null {
  if (places.some((p) => p.kind === "you" && p.installed)) return "Installed for you";
  const repos = places.filter((p) => p.kind === "repo" && (p.installed || p.committed)).length;
  if (repos === 0) return null;
  return repos === 1 ? "Installed in 1 repository" : `Installed in ${repos} repositories`;
}

/** Whether version `latest` is newer than `have` (dotted numbers; a suffix is ignored). */
export function isNewer(latest: string | null, have: string | null): boolean {
  if (!latest || !have) return false;
  const parts = (v: string) => v.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parts(latest), parts(have)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}
