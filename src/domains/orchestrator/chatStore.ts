import { create } from "zustand";
import { getAnthropicKey } from "@/ipc/orchestrator";
import { type ChatTurn, type ConfirmRequest, runOrchestratorTurn } from "./agent";
import { buildBoardContext } from "./context";

// The orchestrator conversation. Visible history is plain user/assistant text;
// within-turn tool round-trips happen inside runOrchestratorTurn and aren't
// persisted (the board snapshot, rebuilt each send, is the source of truth, so
// stale tool results never linger). One in-flight turn at a time.

const SYSTEM_PREAMBLE = `You are the Orchestrator, a delivery assistant embedded in "trace" — a Kanban app where every ticket is a Jira issue and the work is done by parallel Claude coding agents, each in its own git worktree.

You help the user run the board: summarize sprint status, recommend what to play next, explain what agents are doing, and surface risks and blockers.

Ground rules:
- CURRENT BOARD STATE reflects the user's active board filter (see its SCOPE line). Only ever reason about, recommend, or act on tickets listed there — never suggest or touch a ticket that isn't in the snapshot, even if you remember it from earlier in the conversation.
- Every NUMBER in CURRENT BOARD STATE is computed deterministically — trust it; never recount or estimate counts yourself.
- You can read (ticket details, agent transcripts) and act (move a ticket, start an agent, send input to an agent, comment on a ticket). Every action pops a confirmation card the user must approve before it runs — so propose and take actions freely; the user is the gate. Don't ask "shall I?" in prose and then wait — just call the tool; the card is the ask.
- You do NOT raise or merge pull requests — the coding agents do that themselves. If a ticket looks ready, say so and offer to move it, but never try to raise or merge a PR.
- Proactively suggest completing finished work: when a ticket's work looks done — most clearly when its PR is merged — and it isn't already in the COMPLETION COLUMN, offer to move it there with move_issue. Like every action, it only runs after the user confirms the card.
- Be concise and concrete. Reference tickets by key, lead with the recommendation, and keep answers skimmable.
- When recommending what to play next: prefer unblocked over blocked, higher priority first, avoid piling new work on someone who already has agents waiting on them, and never recommend tickets already in progress or done. When a SPRINT GOAL is set, weight your recommendations toward it.`;

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Name of the tool the assistant is mid-call on, for a live status line. */
  tool?: string;
}

/** A mutating action awaiting the user's approval, shown as a confirm card. */
export interface PendingConfirm {
  name: string;
  summary: string;
}

interface ChatStore {
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  /** Set while the assistant is blocked on a confirm-card. */
  pendingConfirm: PendingConfirm | null;
  send: (text: string) => Promise<void>;
  /** Resolve the open confirm-card — true runs the action, false declines it. */
  resolveConfirm: (ok: boolean) => void;
  reset: () => void;
}

function systemPrompt(): string {
  return `${SYSTEM_PREAMBLE}\n\nCURRENT BOARD STATE:\n${buildBoardContext()}`;
}

// The open confirm-card's resolver and the in-flight turn's abort handle live
// module-side (not in store state) — transient hooks, not serializable UI state.
let confirmResolver: ((ok: boolean) => void) | null = null;
let abortController: AbortController | null = null;

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  busy: false,
  error: null,
  pendingConfirm: null,

  async send(text) {
    const trimmed = text.trim();
    if (!trimmed || get().busy) return;

    const key = await getAnthropicKey();
    if (!key) {
      set({ error: "Add your Anthropic API key in Settings → Assistant to use the orchestrator." });
      return;
    }

    // History to send = prior visible turns + this user message (NOT the empty
    // assistant placeholder we add for streaming).
    const history: ChatTurn[] = get().messages.map((m) => ({ role: m.role, text: m.text }));
    history.push({ role: "user", text: trimmed });

    set((s) => ({
      messages: [...s.messages, { role: "user", text: trimmed }, { role: "assistant", text: "" }],
      busy: true,
      error: null,
    }));
    const idx = get().messages.length - 1; // the assistant placeholder
    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      set((s) => ({ messages: s.messages.map((m, i) => (i === idx ? fn(m) : m)) }));

    const ac = new AbortController();
    abortController = ac;
    try {
      await runOrchestratorTurn({
        apiKey: key,
        system: systemPrompt(),
        history,
        signal: ac.signal,
        onTextDelta: (delta) => patch((m) => ({ ...m, text: m.text + delta, tool: undefined })),
        onToolUse: (name) => patch((m) => ({ ...m, tool: name })),
        // Surface a confirm-card and park the turn until the user answers.
        confirmTool: (req: ConfirmRequest) =>
          new Promise<boolean>((resolve) => {
            confirmResolver = resolve;
            set({ pendingConfirm: { name: req.name, summary: req.summary } });
          }),
      });
      patch((m) => ({ ...m, tool: undefined }));
    } catch (e) {
      // An aborted turn (reset/clear) leaves no message to patch — skip it.
      // Any other mid-conversation failure surfaces in the assistant bubble;
      // `error` is reserved for pre-send problems (e.g. no key) so the banner
      // and the bubble never show the same failure twice.
      if (!ac.signal.aborted) {
        const msg = e instanceof Error ? e.message : String(e);
        patch((m) => ({ ...m, text: m.text || `⚠️ ${msg}`, tool: undefined }));
      }
    } finally {
      if (abortController === ac) abortController = null;
      // Don't stomp state a concurrent reset() already cleared.
      if (!ac.signal.aborted) set({ busy: false, pendingConfirm: null });
      confirmResolver = null;
    }
  },

  resolveConfirm(ok) {
    const resolve = confirmResolver;
    confirmResolver = null;
    set({ pendingConfirm: null });
    resolve?.(ok);
  },

  reset() {
    // Stop the in-flight turn outright (so it can't keep streaming/spending),
    // decline any open confirm to unwind its promise, and clear the UI.
    abortController?.abort();
    abortController = null;
    confirmResolver?.(false);
    confirmResolver = null;
    set({ messages: [], busy: false, error: null, pendingConfirm: null });
  },
}));
