import Anthropic from "@anthropic-ai/sdk";
import { actionSummary, runWriteTool, WRITE_TOOL_NAMES, WRITE_TOOLS } from "./mutations";
import { READ_TOOLS, runReadTool } from "./tools";

const TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

/** A pending mutating action awaiting the user's approval. */
export interface ConfirmRequest {
  name: string;
  input: unknown;
  summary: string;
}

// The orchestrator's call into Claude. We run the agentic loop *manually*
// (rather than the SDK's auto tool-runner) so Phase 3 can drop a human
// confirm-gate between a tool_use and its execution on the same seam.
//
// The Anthropic SDK runs in the renderer (`dangerouslyAllowBrowser`), which
// sends `anthropic-dangerous-direct-browser-access: true` so the API serves the
// CORS preflight. The key is the user's own, read from the 0600 Rust store.

const MODEL = "claude-opus-4-8";
// A board answer is short; this is a generous ceiling (incl. adaptive thinking),
// not a target — streaming means no timeout risk if a turn does run long.
const MAX_TOKENS = 16_000;
// Backstop against a model that loops on tools forever.
const MAX_TOOL_ROUNDS = 8;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface RunOptions {
  apiKey: string;
  system: string;
  /** Prior turns plus the new user message, oldest first. */
  history: ChatTurn[];
  signal?: AbortSignal;
  onTextDelta: (delta: string) => void;
  onToolUse?: (name: string) => void;
  /** Gate a mutating tool: resolve true to run it, false to decline. */
  confirmTool: (req: ConfirmRequest) => Promise<boolean>;
}

/**
 * Run one orchestrator turn: stream the assistant reply, executing any
 * read-only tools the model calls and looping until it stops. Returns the final
 * assistant text. Read-only in Phase 2 — tools never mutate.
 */
export async function runOrchestratorTurn(opts: RunOptions): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.MessageParam[] = opts.history.map((m) => ({
    role: m.role,
    content: m.text,
  }));

  let finalText = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      },
      { signal: opts.signal }
    );
    stream.on("text", (delta) => opts.onTextDelta(delta));
    const message = await stream.finalMessage();
    // Push the assistant turn verbatim (incl. thinking blocks) so the next loop
    // iteration replays it correctly on the same model.
    messages.push({ role: "assistant", content: message.content });

    finalText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (message.stop_reason !== "tool_use") return finalText;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      const content = await runToolBlock(block, opts);
      results.push({ type: "tool_result", tool_use_id: block.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  return finalText;
}

/**
 * Run one tool_use block. Mutating tools pass through the confirm-gate first —
 * a decline feeds a "user declined" result back so the model can respond rather
 * than the action silently failing.
 */
async function runToolBlock(block: Anthropic.ToolUseBlock, opts: RunOptions): Promise<string> {
  try {
    if (WRITE_TOOL_NAMES.has(block.name)) {
      const ok = await opts.confirmTool({
        name: block.name,
        input: block.input,
        summary: actionSummary(block.name, block.input),
      });
      if (!ok) return "The user declined this action.";
      opts.onToolUse?.(block.name);
      return await runWriteTool(block.name, block.input);
    }
    opts.onToolUse?.(block.name);
    return await runReadTool(block.name, block.input);
  } catch (e) {
    return `Error running ${block.name}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
