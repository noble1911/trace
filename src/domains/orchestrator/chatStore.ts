import { create } from "zustand";
import { getAnthropicKey } from "@/ipc/orchestrator";
import { type ChatTurn, type ConfirmRequest, runOrchestratorTurn } from "./agent";
import { runOrchestratorCli } from "./cli";
import { buildBoardContext } from "./context";
import { speedModels, useOrchestratorStore } from "./store";

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
- start_agent is the WHOLE "begin work" action: it moves the ticket to In Progress and launches the agent with the user's kickoff brief already submitted. After calling it for a ticket, do not call move_issue or send_to_agent for that same ticket in the same breath — the agent is already briefed and working. send_to_agent is only for nudging an agent that is already running and waiting.
- You do NOT raise or merge pull requests — the coding agents do that themselves. If a ticket looks ready, say so and offer to move it, but never try to raise or merge a PR.
- Proactively suggest completing finished work: when a ticket's work looks done — most clearly when its PR is merged — and it isn't already in the COMPLETION COLUMN, offer to move it there with move_issue. Like every action, it only runs after the user confirms the card.
- Be concise and concrete. Reference tickets by key, lead with the recommendation, and keep answers skimmable.
- You can draw a chart inline with a fenced \`chart\` code block. For BOARD stats use a deterministic kind — the app supplies the data, you only pick it: {"kind":"progress"} (done vs remaining), {"kind":"columns"} (tickets per column), {"kind":"assignees"} (tickets per assignee), {"kind":"throughput","days":14} (PRs merged per day); put ONLY the kind (never numbers) in these. For ANY OTHER data — figures you fetched from a tool/MCP (Jira velocity, Sentry trends, story points per sprint, …) — emit a Vega-Lite spec instead, with the data inline, e.g. {"mark":"line","data":{"values":[{"week":"W1","bugs":12}]},"encoding":{"x":{"field":"week","type":"nominal"},"y":{"field":"bugs","type":"quantitative"}}}. Only ever chart real data you have or fetched — never invented numbers. Reach for a chart when a distribution or trend reads better shown than told, with a one-line narration.
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

// Transient hooks for the in-flight turn, module-side (not serializable UI
// state). `sendGen` is bumped by each send and by reset(); a turn only touches
// the store while its generation is current, so a superseded turn — including a
// CLI reply that can't be aborted mid-flight — never patches a stale message.
let confirmResolver: ((ok: boolean) => void) | null = null;
let abortController: AbortController | null = null;
let sendGen = 0;

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  busy: false,
  error: null,
  pendingConfirm: null,

  async send(text) {
    const trimmed = text.trim();
    if (!trimmed || get().busy) return;

    const { backend, speed } = useOrchestratorStore.getState();
    const models = speedModels(speed);
    // The SDK path needs an API key; the CLI path uses the logged-in Claude CLI.
    let key: string | null = null;
    if (backend === "sdk") {
      key = await getAnthropicKey();
      if (!key) {
        set({
          error:
            "Add your Anthropic API key in Settings → Assistant, or switch to Claude CLI mode.",
        });
        return;
      }
    }

    // History to send = prior visible turns + this user message (NOT the empty
    // assistant placeholder we add for streaming).
    const history: ChatTurn[] = get().messages.map((m) => ({ role: m.role, text: m.text }));
    history.push({ role: "user", text: trimmed });

    const myGen = ++sendGen;
    set((s) => ({
      messages: [...s.messages, { role: "user", text: trimmed }, { role: "assistant", text: "" }],
      busy: true,
      error: null,
    }));
    const idx = get().messages.length - 1; // the assistant placeholder
    const live = () => myGen === sendGen;
    const patch = (fn: (m: ChatMessage) => ChatMessage) => {
      if (live()) set((s) => ({ messages: s.messages.map((m, i) => (i === idx ? fn(m) : m)) }));
    };

    let ac: AbortController | null = null;
    try {
      if (backend === "cli") {
        // One-shot through the Claude CLI — no streaming, actions via blocks.
        const reply = await runOrchestratorCli(history, models.cli);
        patch((m) => ({ ...m, text: reply, tool: undefined }));
      } else if (key) {
        ac = new AbortController();
        abortController = ac;
        await runOrchestratorTurn({
          apiKey: key,
          model: models.sdk,
          extendedThinking: models.thinking,
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
      }
    } catch (e) {
      // patch() is generation-guarded, so a superseded turn shows nothing. `error`
      // stays reserved for pre-send problems (e.g. no key) so the banner and the
      // assistant bubble never report the same failure twice.
      const msg = e instanceof Error ? e.message : String(e);
      patch((m) => ({ ...m, text: m.text || `⚠️ ${msg}`, tool: undefined }));
    } finally {
      if (ac && abortController === ac) abortController = null;
      if (live()) set({ busy: false, pendingConfirm: null });
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
    // Supersede any in-flight turn (its callbacks go no-op), stop an SDK stream
    // from spending, unwind an open confirm, and clear the UI.
    sendGen++;
    abortController?.abort();
    abortController = null;
    confirmResolver?.(false);
    confirmResolver = null;
    set({ messages: [], busy: false, error: null, pendingConfirm: null });
  },
}));
