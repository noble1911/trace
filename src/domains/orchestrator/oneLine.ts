import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicKey, orchestratorCli } from "@/ipc/orchestrator";
import { useOrchestratorStore } from "./store";

// One short line from Haiku, on whichever transport the Assistant is set to
// (Settings → Assistant): the user's API key through the SDK, or the logged-in
// Claude CLI. Shared by the buddy's speech bubble, a new session's name and each agent's
// recap (`shortReply`, a few lines).
//
// Null is "not this time", never an error: with no key and no CLI there is no
// transport at all, and a line this small is never worth a toast. Callers have a
// fallback or say nothing.

const MODEL = "claude-haiku-5-5";
const CLI_MODEL = "haiku";

/**
 * A model's reply as one line: its first line, unquoted, cut to `max` characters
 * with an ellipsis. Null when nothing is left of it.
 */
export function firstLine(raw: string, max: number): string | null {
  const first = raw.trim().split("\n")[0]?.trim() ?? "";
  const unquoted = first.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!unquoted) return null;
  return unquoted.length > max ? `${unquoted.slice(0, max - 1)}…` : unquoted;
}

/** The model's text reply, or null on a refusal. */
async function viaSdk(apiKey: string, system: string, prompt: string): Promise<string | null> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const res = await client.messages.create({
    model: MODEL,
    // Room for Haiku's (low-effort) thinking before a short answer.
    max_tokens: 1536,
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") return null;
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Haiku's whole reply to `prompt` under `system` (a few lines at most), or null
 * when there's no transport or it fails. The recap (`domains/recap`) reads its
 * four lines from this; `oneLine` keeps the first line of it.
 */
export async function shortReply(system: string, prompt: string): Promise<string | null> {
  try {
    if (useOrchestratorStore.getState().backend === "cli") {
      return await orchestratorCli(system, prompt, CLI_MODEL);
    }
    const key = await getAnthropicKey();
    return key ? await viaSdk(key, system, prompt) : null;
  } catch {
    return null;
  }
}

/** One line for `prompt` under `system`, or null when there's no transport or it fails. */
export async function oneLine(system: string, prompt: string, max: number): Promise<string | null> {
  const raw = await shortReply(system, prompt);
  return raw === null ? null : firstLine(raw, max);
}
