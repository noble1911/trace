import type { SessionGroups, SessionSection } from "./types";

// Pure transforms over the tabs/sections structure. Each returns a new
// SessionGroups for the store's saveGroups — array order is display order,
// so reordering is just rebuilding the array.

/** Remove `dragId` and re-insert it before `targetId` (no-op if either is missing). */
export function moveBefore<T extends { id: string }>(
  list: T[],
  dragId: string,
  targetId: string
): T[] {
  const dragged = list.find((x) => x.id === dragId);
  if (!dragged) return list;
  const without = list.filter((x) => x.id !== dragId);
  const at = without.findIndex((x) => x.id === targetId);
  if (at < 0) return list;
  return [...without.slice(0, at), dragged, ...without.slice(at)];
}

/** Append a new tab; returns the structure and the new tab's id. */
export function withNewTab(
  groups: SessionGroups,
  name: string
): { next: SessionGroups; id: string } {
  const id = crypto.randomUUID();
  return { next: { ...groups, tabs: [...groups.tabs, { id, name }] }, id };
}

export function renameTabIn(groups: SessionGroups, id: string, name: string): SessionGroups {
  return { ...groups, tabs: groups.tabs.map((t) => (t.id === id ? { ...t, name } : t)) };
}

export function withoutTab(groups: SessionGroups, id: string): SessionGroups {
  return { ...groups, tabs: groups.tabs.filter((t) => t.id !== id) };
}

export function withNewSection(
  groups: SessionGroups,
  name: string,
  tab: string | null
): SessionGroups {
  return {
    ...groups,
    sections: [...groups.sections, { id: crypto.randomUUID(), name, tab, collapsed: false }],
  };
}

export function patchSectionIn(
  groups: SessionGroups,
  id: string,
  patch: Partial<SessionSection>
): SessionGroups {
  return {
    ...groups,
    sections: groups.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  };
}

export function withoutSection(groups: SessionGroups, id: string): SessionGroups {
  return { ...groups, sections: groups.sections.filter((s) => s.id !== id) };
}

/** Move a section to the end of the list (used by "drop on unsectioned area"). */
export function sectionToEnd(groups: SessionGroups, id: string): SessionGroups {
  const dragged = groups.sections.find((s) => s.id === id);
  if (!dragged) return groups;
  return { ...groups, sections: [...groups.sections.filter((s) => s.id !== id), dragged] };
}
