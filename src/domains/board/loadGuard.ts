// A board load and the edits that land while it's in flight. A load answers with the
// board as it was when it was asked for; an edit put on screen since (a custom board's
// command answers with the fresh board) is newer, so that answer mustn't replace it.
// Pure apart from the one shared guard, so `npm test` can load it.

/** Counts edits put on screen; a load notes the count as it starts. */
export interface LoadGuard {
  /** Call as a load starts; hand the ticket to `isStale` when it answers. */
  start: () => number;
  /** An edit's result was put on screen. */
  noteEdit: () => void;
  /** Whether an edit landed after the load holding `ticket` started. */
  isStale: (ticket: number) => boolean;
}

export function createLoadGuard(): LoadGuard {
  let edits = 0;
  return {
    start: () => edits,
    noteEdit: () => {
      edits++;
    },
    isStale: (ticket) => ticket !== edits,
  };
}

/** The board store's guard: `loadBoard` checks it, `boardEdits.applyBoardData` notes edits. */
export const boardLoads = createLoadGuard();

// A hot update would leave the store on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
