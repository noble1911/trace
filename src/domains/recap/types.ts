// An agent's recap: where its work is up to. Mirrors `src-tauri/src/recap.rs`.

/** The four lines Haiku writes. */
export interface RecapText {
  goal: string;
  done: string;
  now: string;
  next: string;
}

export interface Recap extends RecapText {
  /** When it was written (epoch ms); 0 = never (only `seenAt` is known). */
  at: number;
  /** The Claude conversation `offset` belongs to. */
  sessionId: string | null;
  /** Byte offset into the conversation file this recap covers up to. */
  offset: number;
  /** When the user last opened the workspace (epoch ms); 0 = never recorded. */
  seenAt: number;
}

/** Whether a stored entry has a written recap (not just a `seenAt`). */
export function hasRecap(r: Recap | undefined): r is Recap {
  return r !== undefined && r.at > 0 && r.now.length > 0;
}
