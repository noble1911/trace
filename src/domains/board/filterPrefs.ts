// The board's filter choices, remembered across launches (best-effort — a
// blocked localStorage just means every launch starts unfiltered).

import { isAllTypes, parseTypeSelection, type TypeSelection } from "./typeSelection";

export type BoardFilter = "all" | "active" | "running";

const FILTER_KEY = "trace.boardFilter";
const ASSIGNEE_KEY = "trace.assigneeFilter";
const TYPE_KEY = "trace.typeFilter";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

export function loadFilter(): BoardFilter {
  const v = read(FILTER_KEY);
  return v === "active" || v === "running" ? v : "all";
}

export function saveFilter(filter: BoardFilter) {
  write(FILTER_KEY, filter);
}

// `undefined` = never chosen (defaults to me), `null` = all, string = an account.
export function loadAssigneeFilter(): string | null | undefined {
  const v = read(ASSIGNEE_KEY);
  if (v === null) return undefined;
  return v === "all" ? null : v;
}

export function saveAssigneeFilter(accountId: string | null) {
  write(ASSIGNEE_KEY, accountId ?? "all");
}

export function loadTypeFilter(): TypeSelection {
  return parseTypeSelection(read(TYPE_KEY));
}

export function saveTypeFilter(sel: TypeSelection) {
  write(TYPE_KEY, isAllTypes(sel) ? null : JSON.stringify(sel));
}
