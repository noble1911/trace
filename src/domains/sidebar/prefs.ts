import type { NavId } from "../../app/nav.ts";
import { DEFAULT_SIDEBAR, type SidebarEntry, sidebarItem, type Visibility } from "./items.ts";

// The persisted sidebar: the rail's items in the user's order, each with its
// visibility. localStorage is user-editable and the item list changes between
// versions, so a stored list is merged onto the built-in one rather than trusted.

const KEY = "trace.sidebar";

const isVisibility = (v: unknown): v is Visibility =>
  v === "auto" || v === "shown" || v === "hidden";

const isFixed = (id: NavId) => sidebarItem(id)?.isFixed === true;

/**
 * Merge a stored list onto the built-in one: unknown ids and repeats are dropped, a
 * bad visibility becomes `auto`, an item the stored list lacks (new in this version)
 * goes back in after the item it follows by default, and fixed items keep their
 * built-in place and visibility.
 */
export function parseSidebar(raw: unknown): SidebarEntry[] {
  if (!Array.isArray(raw)) return DEFAULT_SIDEBAR;
  const out: SidebarEntry[] = [];
  const seen = new Set<NavId>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { id, visibility } = item as Record<string, unknown>;
    if (typeof id !== "string") continue;
    const def = sidebarItem(id as NavId);
    if (!def || def.isFixed || seen.has(def.id)) continue;
    seen.add(def.id);
    out.push({ id: def.id, visibility: isVisibility(visibility) ? visibility : "auto" });
  }
  DEFAULT_SIDEBAR.forEach((entry, i) => {
    if (seen.has(entry.id) || isFixed(entry.id)) return;
    // After the nearest item that comes before it by default, or first.
    const prev = DEFAULT_SIDEBAR.slice(0, i)
      .reverse()
      .find((e) => seen.has(e.id));
    const at = prev ? out.findIndex((e) => e.id === prev.id) + 1 : 0;
    out.splice(at, 0, { ...entry });
    seen.add(entry.id);
  });
  for (const entry of DEFAULT_SIDEBAR) if (isFixed(entry.id)) out.push({ ...entry });
  return out;
}

/** Move `id` to just before `before` (null = last of the movable items). */
export function moveEntry(
  entries: SidebarEntry[],
  id: NavId,
  before: NavId | null
): SidebarEntry[] {
  const entry = entries.find((e) => e.id === id);
  if (!entry || isFixed(id) || id === before) return entries;
  const rest = entries.filter((e) => e.id !== id);
  const firstFixed = rest.findIndex((e) => isFixed(e.id));
  const end = firstFixed === -1 ? rest.length : firstFixed;
  const target = before === null ? end : rest.findIndex((e) => e.id === before);
  const at = target === -1 ? end : Math.min(target, end);
  return [...rest.slice(0, at), entry, ...rest.slice(at)];
}

/** Move `id` one place up (-1) or down (+1), never past a fixed item. */
export function nudgeEntry(entries: SidebarEntry[], id: NavId, delta: -1 | 1): SidebarEntry[] {
  const i = entries.findIndex((e) => e.id === id);
  const j = i + delta;
  if (i === -1 || isFixed(id) || j < 0 || j >= entries.length || isFixed(entries[j].id)) {
    return entries;
  }
  const out = [...entries];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Whether `entries` is the built-in order and visibility. */
export function isDefaultSidebar(entries: SidebarEntry[]): boolean {
  return (
    entries.length === DEFAULT_SIDEBAR.length &&
    entries.every(
      (e, i) => e.id === DEFAULT_SIDEBAR[i].id && e.visibility === DEFAULT_SIDEBAR[i].visibility
    )
  );
}

export function loadSidebar(): SidebarEntry[] {
  try {
    const s = localStorage.getItem(KEY);
    return parseSidebar(s ? JSON.parse(s) : null);
  } catch {
    return DEFAULT_SIDEBAR;
  }
}

export function saveSidebar(entries: SidebarEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // best-effort persistence, like the app's other view prefs
  }
}
