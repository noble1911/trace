import Anthropic from "@anthropic-ai/sdk";
import { READ_TOOLS, runReadTool } from "./tools";

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
        tools: READ_TOOLS,
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
      opts.onToolUse?.(block.name);
      let content: string;
      try {
        content = await runReadTool(block.name, block.input);
      } catch (e) {
        content = `Error running ${block.name}: ${e instanceof Error ? e.message : String(e)}`;
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  return finalText;
}
