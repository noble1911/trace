import { transcriptText } from "@/domains/agent/transcript";
import { useBoardStore } from "@/domains/board/store";
import { watchForQuiet } from "@/domains/board/waitingNotify";
import { sendAgentInput } from "@/ipc/agent";
import type { AskKind } from "./types";

// Answering an agent without opening its terminal: keystrokes into its PTY, the
// same channel the orchestrator uses. Claude Code's permission and plan prompts
// are select menus that open on their first option ("Yes"), so — checked against
// a live prompt — Enter accepts it, Down then Enter takes the second ("Yes, and
// don't ask again"), and Esc declines ("No, and tell Claude what to do").

export type Choice = "yes" | "always" | "no";

/** Buttons each kind of ask gets; others are answered in the terminal or with a reply. */
export const CHOICES: Partial<Record<AskKind, { choice: Choice; label: string }[]>> = {
  permission: [
    { choice: "yes", label: "Allow once" },
    { choice: "always", label: "Always allow" },
    { choice: "no", label: "Deny" },
  ],
  plan: [
    { choice: "yes", label: "Approve plan" },
    { choice: "no", label: "Keep planning" },
  ],
};

/** Kinds whose prompt is a menu that has to be dismissed before typing a reply. */
const MENU_KINDS = new Set<AskKind>(["permission", "plan"]);

/**
 * Kinds a typed reply can't answer: a multiple-choice question is a menu too,
 * and Enter would pick its first option with the text ignored.
 */
export const TERMINAL_ONLY = new Set<AskKind>(["question"]);

const DOWN = "\x1b[B";
const ESC = "\x1b";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The user acted — re-arm notifications and clear the ask, as typing in the
 * terminal does — and the agent is back at work: without this the light would
 * read "Turn finished" until its first output. The quiet timer flips it back
 * if nothing comes.
 */
function userActed(workspaceId: string) {
  const board = useBoardStore.getState();
  board.noteUserTurn(workspaceId);
  board.setActivity(workspaceId, "working");
  watchForQuiet(workspaceId);
}

/**
 * Whether the prompt on screen has a "don't ask again" option. Not every
 * permission prompt does, and on one without it the second option is "No" —
 * so "Always allow" checks the screen rather than trusting the position.
 */
function offersAlways(workspaceId: string): boolean {
  const chunks = useBoardStore.getState().outputBuffers[workspaceId] ?? [];
  // Cursor moves stand in for spaces in the TUI, so compare without whitespace.
  const screen = transcriptText(chunks.slice(-60), 6000).replace(/\s+/g, "").toLowerCase();
  return screen.includes("don'taskagain") || screen.includes("don\u2019taskagain");
}

/** Pick an option on the agent's pending permission / plan prompt. */
export async function choose(workspaceId: string, choice: Choice): Promise<void> {
  if (choice === "always" && !offersAlways(workspaceId)) {
    throw new Error('this prompt has no "always allow" option — answer it in the terminal');
  }
  userActed(workspaceId);
  if (choice === "yes") return sendAgentInput(workspaceId, "\r");
  if (choice === "no") return sendAgentInput(workspaceId, ESC);
  // Separate writes: the TUI must see the arrow land before Enter confirms.
  await sendAgentInput(workspaceId, DOWN);
  await pause(150);
  return sendAgentInput(workspaceId, "\r");
}

/**
 * Send the agent a message. If it's sitting on a permission/plan menu, Esc
 * first — that's "No, and tell Claude what to do", which leaves the prompt
 * waiting for exactly this message.
 */
export async function reply(
  workspaceId: string,
  text: string,
  pendingKind: AskKind | null
): Promise<void> {
  const message = text.trim();
  if (!message) return;
  if (pendingKind && TERMINAL_ONLY.has(pendingKind)) {
    throw new Error("a multiple-choice question has to be answered in the terminal");
  }
  userActed(workspaceId);
  if (pendingKind && MENU_KINDS.has(pendingKind)) {
    await sendAgentInput(workspaceId, ESC);
    await pause(400);
  }
  await sendAgentInput(workspaceId, `${message}\r`);
}
