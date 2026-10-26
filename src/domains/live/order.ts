// The order agents are listed in (inbox, fleet): when they were opened, unless
// the user dragged them — and a drag moves only the row dragged. Rows never
// move on their own when an agent changes state.

/**
 * `ids` in display order. With a manual order, the ids it names keep that
 * order; anything opened since it was saved follows, oldest first.
 */
export function orderIds(
  ids: string[],
  openedAt: (id: string) => number,
  manual: string[] | null
): string[] {
  const byOpened = [...ids].sort((a, b) => openedAt(a) - openedAt(b));
  if (!manual) return byOpened;
  const present = new Set(ids);
  const pinned = manual.filter((id) => present.has(id));
  const pinnedSet = new Set(pinned);
  return [...pinned, ...byOpened.filter((id) => !pinnedSet.has(id))];
}

/** Move `id` to just before `before` (`null` = the end). */
export function moveId(order: string[], id: string, before: string | null): string[] {
  if (id === before) return order;
  const without = order.filter((x) => x !== id);
  const at = before === null ? without.length : without.indexOf(before);
  if (at < 0) return order;
  return [...without.slice(0, at), id, ...without.slice(at)];
}

/** Move `id` one place up (-1) or down (+1) — the keyboard version of a drag. */
export function nudgeId(order: string[], id: string, by: -1 | 1): string[] {
  const i = order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
