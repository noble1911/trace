// Which issue types the board shows. Two ways to say it, because people ask
// both: "Stories + Epics" (include) and "everything but Tasks" (exclude). A
// type is never in both lists; with nothing included, everything not excluded shows.

export interface TypeSelection {
  include: string[];
  exclude: string[];
}

export const ALL_TYPES: TypeSelection = { include: [], exclude: [] };

export function isAllTypes(sel: TypeSelection): boolean {
  return sel.include.length === 0 && sel.exclude.length === 0;
}

/** Click toggles a type in `include`; ⌥-click toggles it in `exclude`. */
export function toggleType(
  sel: TypeSelection,
  type: string,
  mode: "include" | "exclude"
): TypeSelection {
  const without = (list: string[]) => list.filter((t) => t !== type);
  const flip = (list: string[]) => (list.includes(type) ? without(list) : [...list, type]);
  return mode === "include"
    ? { include: flip(sel.include), exclude: without(sel.exclude) }
    : { include: without(sel.include), exclude: flip(sel.exclude) };
}

/**
 * Drop types this board doesn't have. The selection is remembered across
 * boards, and "only Epics" on a board without epics should show everything,
 * not an empty board.
 */
export function forBoard(sel: TypeSelection, boardTypes: string[]): TypeSelection {
  return {
    include: sel.include.filter((t) => boardTypes.includes(t)),
    exclude: sel.exclude.filter((t) => boardTypes.includes(t)),
  };
}

export function showsType(sel: TypeSelection, type: string): boolean {
  if (sel.include.length > 0) return sel.include.includes(type);
  return !sel.exclude.includes(type);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
}

/** Parse a saved selection. A bare string is the old single-type format. */
export function parseTypeSelection(raw: string | null): TypeSelection {
  if (raw === null) return ALL_TYPES;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null) {
      const o = v as Record<string, unknown>;
      return { include: strings(o.include), exclude: strings(o.exclude) };
    }
  } catch {
    // not JSON — fall through to the old format
  }
  return { include: [raw], exclude: [] };
}
