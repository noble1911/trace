import type { BoardSummary, Priority } from "../issues/types.ts";
import { matchName, parseBoardRef } from "../orchestrator/boardRef.ts";

// Reading the arguments of create_card / update_card. Pure, so `npm test` can load it.

const WORDS: Record<string, Priority> = {
  highest: "p0",
  high: "p1",
  medium: "p2",
  low: "p3",
};

/** A priority as `p0`..`p3` or the words the ticket view uses; undefined when not given. */
export function parsePriority(raw: unknown): Priority | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (text === "p0" || text === "p1" || text === "p2" || text === "p3") return text;
  const word = WORDS[text];
  if (!word) throw new Error("priority must be p0 (highest), p1, p2 or p3 (low).");
  return word;
}

/** Labels as a list of strings, or one comma-separated string; undefined when not given. */
export function parseLabels(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
  if (!list || list.some((l) => typeof l !== "string")) {
    throw new Error("labels must be a list of strings.");
  }
  return list.map((l) => String(l).trim()).filter(Boolean);
}

/**
 * The custom board a create_card names: `custom:<id>`, or the board's name. Left out, it
 * is the only one when there's just one. Throws a sentence naming what exists otherwise,
 * and says so when the reference is another tracker's board.
 */
export function pickCustomBoard(boards: BoardSummary[], ref: string): BoardSummary {
  const list = boards.map((b) => `custom:${b.id} "${b.name}"`).join(", ") || "none yet";
  if (!ref) {
    if (boards.length === 1) return boards[0];
    throw new Error(`Give board: one of the trace boards (${list}).`);
  }
  const parsed = parseBoardRef(ref);
  if (parsed && parsed.provider !== "custom") {
    throw new Error(
      `${ref} is a ${parsed.provider === "jira" ? "Jira" : "Pylon"} board: cards can only be created on trace's own boards (${list}).`
    );
  }
  const found = parsed
    ? boards.find((b) => b.id === parsed.boardId)
    : matchName(boards, ref, (b) => b.name);
  if (!found) throw new Error(`No trace board "${ref}". Trace boards: ${list}.`);
  return found;
}
