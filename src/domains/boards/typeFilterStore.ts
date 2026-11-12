import { create } from "zustand";
import { isAllTypes, parseTypeSelection, type TypeSelection } from "@/domains/board/typeSelection";

// The type filter on trace's own boards, remembered per board. A tracker's boards share
// one remembered selection (Jira's types are the same on every board), but a custom
// board's types are its own: "only Bugs" from Jira would quietly narrow a board that
// happens to have a Bug type, so each custom board keeps its own choice.

const STORAGE_KEY = "trace.customTypeFilter";

function read(): Record<string, TypeSelection> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([key, sel]) => [key, parseTypeSelection(JSON.stringify(sel))])
    );
  } catch {
    return {};
  }
}

interface CustomTypeFilterStore {
  byBoard: Record<string, TypeSelection>;
  select: (boardKey: string, sel: TypeSelection) => void;
}

export const useCustomTypeFilter = create<CustomTypeFilterStore>((set, get) => ({
  byBoard: read(),
  select(boardKey, sel) {
    const { [boardKey]: _old, ...rest } = get().byBoard;
    const byBoard = isAllTypes(sel) ? rest : { ...rest, [boardKey]: sel };
    set({ byBoard });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(byBoard));
    } catch {
      // best-effort: a blocked localStorage just forgets it next launch
    }
  },
}));

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
