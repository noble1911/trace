import Anthropic from "@anthropic-ai/sdk";
import { useOrchestratorStore } from "@/domains/orchestrator/store";
import { getAnthropicKey, orchestratorCli } from "@/ipc/orchestrator";

// The buddy's voice: one short line from Haiku. Reuses the Assistant's
// transport choice (Settings → Assistant): the user's API key via the SDK, or
// the logged-in Claude CLI. No key and no CLI → the buddy stays quiet.

const MODEL = "claude-haiku-5-5";
const CLI_MODEL = "haiku";
const MAX_CHARS = 140;

/** The persona, voiced as the chosen character (its manifest name). */
const persona = (
  name: string
) => `You are ${name}, a tiny pixel-art character who lives in the corner of "trace", a desktop app where a developer runs several AI coding agents in parallel, one per Kanban ticket. You watch what happens and react in a small speech bubble.

Rules:
- Reply with ONE line of at most 14 words. Plain text: no quotes, no markdown, at most one emoji.
- Be warm, playful and a little cheeky — a buddy, not an assistant. Don't offer help or give instructions.
- If an agent needs the user or something failed, say that plainly first and name the ticket.
- Only mention things in the events or board status you're given. Never invent details.
- Vary your phrasing; never repeat a recent line.`;

/** Normalise a model reply to one bubble-sized line (or null if empty). */
export function toBubbleLine(raw: string): string | null {
  const first = raw.trim().split("\n")[0]?.trim() ?? "";
  const unquoted = first.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!unquoted) return null;
  return unquoted.length > MAX_CHARS ? `${unquoted.slice(0, MAX_CHARS - 1)}…` : unquoted;
}

async function viaSdk(apiKey: string, system: string, prompt: string): Promise<string | null> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const res = await client.messages.create({
    model: MODEL,
    // Room for Haiku's (low-effort) thinking before the one-line answer.
    max_tokens: 1024,
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") return null;
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return toBubbleLine(text);
}

/** One line for the bubble, or null when there's no transport or the call fails. */
export async function speak(prompt: string, name: string): Promise<string | null> {
  try {
    if (useOrchestratorStore.getState().backend === "cli") {
      return toBubbleLine(await orchestratorCli(persona(name), prompt, CLI_MODEL));
    }
    const key = await getAnthropicKey();
    return key ? await viaSdk(key, persona(name), prompt) : null;
  } catch {
    // A missed quip isn't worth an error toast.
    return null;
  }
}
