import { transcriptText } from "@/domains/agent/transcript";
import { useBoardStore } from "@/domains/board/store";
import { watchForQuiet } from "@/domains/board/waitingNotify";
import { sendAgentInput } from "@/ipc/agent";
import type { Ask, AskKind } from "./types";

// Answering an agent without opening its terminal: keystrokes into its PTY, the
// same channel the orchestrator uses. Claude Code's dialogs are select menus
// that open on their first option. Checked against live prompts: Enter takes
// the highlighted option, Down moves one option down (so a question's option N
// is N-1 Downs then Enter), and Esc declines ("No, and tell Claude what to do").

const DOWN = "\x1b[B";
const ESC = "\x1b";
const ENTER = "\r";

/** One button: its label, and the keys that pick it on the agent's menu. */
export interface AnswerChoice {
  label: string;
  keys: string[];
  /** Positional "don't ask again" on a dialog we couldn't confirm offers it. */
  checkAlways?: boolean;
}

/**
 * The answers an ask gets, in menu order — none where the prompt isn't a plain
 * menu (a multi-question or multi-select question, a bare "needs you", a
 * finished turn): those are answered in the terminal, or by a reply.
 */
export function choicesFor(ask: Ask | null): AnswerChoice[] {
  if (!ask) return [];
  if (ask.kind === "question") {
    return ask.options.map((label, i) => ({
      label,
      keys: [...Array<string>(i).fill(DOWN), ENTER],
    }));
  }
  if (ask.kind === "plan") {
    return [
      { label: "Approve plan", keys: [ENTER] },
      { label: "Keep planning", keys: [ESC] },
    ];
  }
  if (ask.kind !== "permission") return [];
  const out: AnswerChoice[] = [{ label: "Allow once", keys: [ENTER] }];
  // On a dialog without "don't ask again" the second option is "No" — never
  // offer it positionally unless the hook said the option exists.
  if (ask.canAlways !== false) {
    out.push({ label: "Always allow", keys: [DOWN, ENTER], checkAlways: ask.canAlways === null });
  }
  out.push({ label: "Deny", keys: [ESC] });
  return out;
}

/** Kinds whose prompt is a menu that has to be dismissed before typing a reply. */
const MENU_KINDS = new Set<AskKind>(["permission", "plan"]);

/**
 * Kinds a typed reply can't answer: a question is a menu too, and Enter would
 * pick its highlighted option with the text ignored.
 */
export const TERMINAL_ONLY = new Set<AskKind>(["question"]);

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
 * Whether the prompt on screen has a "don't ask again" option — the fallback
 * for agents whose PermissionRequest hook didn't say (an older CLI).
 */
function offersAlways(workspaceId: string): boolean {
  const chunks = useBoardStore.getState().outputBuffers[workspaceId] ?? [];
  // Cursor moves stand in for spaces in the TUI, so compare without whitespace.
  const screen = transcriptText(chunks.slice(-60), 6000).replace(/\s+/g, "").toLowerCase();
  return screen.includes("don'taskagain") || screen.includes("don’taskagain");
}

/** Pick an option on the agent's pending menu (permission, plan, question). */
export async function choose(workspaceId: string, choice: AnswerChoice): Promise<void> {
  if (choice.checkAlways && !offersAlways(workspaceId)) {
    throw new Error('this prompt has no "always allow" option — answer it in the terminal');
  }
  userActed(workspaceId);
  // Separate writes: the TUI must see each arrow land before Enter confirms.
  for (const [i, key] of choice.keys.entries()) {
    if (i > 0) await pause(120);
    await sendAgentInput(workspaceId, key);
  }
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
    throw new Error("a question has to be answered from its options or in the terminal");
  }
  userActed(workspaceId);
  if (pendingKind && MENU_KINDS.has(pendingKind)) {
    await sendAgentInput(workspaceId, ESC);
    await pause(400);
  }
  await sendAgentInput(workspaceId, `${message}\r`);
}
