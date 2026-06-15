import { create } from "zustand";
import { getAnthropicKey } from "@/ipc/orchestrator";
import { type ChatTurn, runOrchestratorTurn } from "./agent";
import { buildBoardContext } from "./context";

// The orchestrator conversation. Visible history is plain user/assistant text;
// within-turn tool round-trips happen inside runOrchestratorTurn and aren't
// persisted (the board snapshot, rebuilt each send, is the source of truth, so
// stale tool results never linger). One in-flight turn at a time.

const SYSTEM_PREAMBLE = `You are the Orchestrator, a delivery assistant embedded in "trace" — a Kanban app where every ticket is a Jira issue and the work is done by parallel Claude coding agents, each in its own git worktree.

You help the user run the board: summarize sprint status, recommend what to play next, explain what agents are doing, and surface risks and blockers.

Ground rules:
- Every NUMBER in CURRENT BOARD STATE is computed deterministically — trust it; never recount or estimate counts yourself.
- You are READ-ONLY right now. You can read ticket details and agent transcripts via tools, but you cannot move tickets, start agents, or comment yet — if asked to act, say what you would do and that actions are coming soon.
- Be concise and concrete. Reference tickets by key, lead with the recommendation, and keep answers skimmable.
- When recommending what to play next: prefer unblocked over blocked, higher priority first, avoid piling new work on someone who already has agents waiting on them, and never recommend tickets already in progress or done.`;

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Name of the tool the assistant is mid-call on, for a live status line. */
  tool?: string;
}

interface ChatStore {
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  reset: () => void;
}

function systemPrompt(): string {
  return `${SYSTEM_PREAMBLE}\n\nCURRENT BOARD STATE:\n${buildBoardContext()}`;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  busy: false,
  error: null,

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

    try {
      await runOrchestratorTurn({
        apiKey: key,
        system: systemPrompt(),
        history,
        onTextDelta: (delta) => patch((m) => ({ ...m, text: m.text + delta, tool: undefined })),
        onToolUse: (name) => patch((m) => ({ ...m, tool: name })),
      });
      patch((m) => ({ ...m, tool: undefined }));
    } catch (e) {
      // A mid-conversation failure surfaces in the assistant bubble; `error` is
      // reserved for pre-send problems (e.g. no key) so the banner and the
      // bubble never show the same failure twice.
      const msg = e instanceof Error ? e.message : String(e);
      patch((m) => ({ ...m, text: m.text || `⚠️ ${msg}`, tool: undefined }));
    } finally {
      set({ busy: false });
    }
  },

  reset() {
    set({ messages: [], error: null });
  },
}));
