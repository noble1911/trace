import type { MouseEvent } from "react";
import type { Issue } from "@/domains/issues/types";
import { ALL_TYPES, isAllTypes, type TypeSelection, toggleType } from "./typeSelection";

/** Every issue type on the board, alphabetical — stable, so chips don't reshuffle as counts move. */
export function boardIssueTypes(issues: Issue[]): string[] {
  return [...new Set(issues.map((i) => i.issueType))].sort((a, b) => a.localeCompare(b));
}

interface TypeFilterProps {
  /** Types on the whole board — a chip per type, whatever the other filters hide. */
  types: string[];
  /** Issues passing the other filters; a chip's count is how many of its type they hold. */
  visible: Issue[];
  /** Already narrowed to this board's types. */
  selected: TypeSelection;
  onSelect: (sel: TypeSelection) => void;
}

// One chip per issue type on the board (Epic, Story, Bug, …). Click adds a type
// to what's shown ("Stories + Epics"); ⌥-click hides it ("everything but Tasks").
// All clears both. Hidden when the board has a single type.
export function TypeFilter({ types, visible, selected, onSelect }: TypeFilterProps) {
  if (types.length <= 1) return null;

  const counts = new Map<string, number>();
  for (const i of visible) counts.set(i.issueType, (counts.get(i.issueType) ?? 0) + 1);

  const onChip = (e: MouseEvent, type: string) =>
    onSelect(toggleType(selected, type, e.altKey ? "exclude" : "include"));

  return (
    <div className="type-filter">
      <span className="tf-label">Type</span>
      <button
        type="button"
        className={`tf-chip${isAllTypes(selected) ? " active" : ""}`}
        onClick={() => onSelect(ALL_TYPES)}
      >
        All
      </button>
      {types.map((t) => {
        const count = counts.get(t) ?? 0;
        const state = selected.include.includes(t)
          ? " active"
          : selected.exclude.includes(t)
            ? " excluded"
            : "";
        return (
          <button
            key={t}
            type="button"
            className={`tf-chip${state}${count === 0 ? " empty" : ""}`}
            onClick={(e) => onChip(e, t)}
            title={`Click to show ${t} · ⌥-click to hide it`}
          >
            {t}
            <span className="tf-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
