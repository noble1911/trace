import type { TranscriptItem } from "@/ipc/transcript";
import type { RecapText } from "./types.ts";

// What Haiku is asked for, and how its reply is read back. Pure, so it's tested
// (`prompt.test.ts`). Each recap updates the last one: the prompt carries the
// previous recap and only the conversation since, so a long session costs no
// more to summarise than a short one.

/** The conversation text sent per recap; the newest end is kept. */
export const MAX_TRANSCRIPT_CHARS = 14_000;
/** Longest piece of one item (a pasted file, a long reply) that's kept. */
const MAX_ITEM = 1_200;
/** Longest line kept from the reply, per field. */
const MAX_FIELD = 240;

export const RECAP_SYSTEM = `You keep a running recap of one AI coding agent's work, for a developer who runs many agents at once and checks in now and then. They read it to know at a glance where this one is up to.

Reply with exactly four lines, nothing else:
Goal: what the work is for, in one plain sentence.
Done: what's finished so far, most important first.
Now: what the agent is doing or waiting on at this moment.
Next: the next step, for the agent or the developer.

Rules:
- At most 20 words per line. Plain text: no markdown, no quotes, no emoji.
- Be concrete: name files, features, PRs and tests rather than "made changes".
- Only state what the conversation or the previous recap shows. Never invent.
- If a previous recap is given, update it: keep its Goal unless the work changed, and carry forward what's still true in Done.
- If the agent is waiting on the developer (a question, a plan to approve, a review), say so in Now.`;

function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** A tool call in a few words: its name and the input that says what it did. */
function toolLine(name: string, input: unknown): string {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const key = ["command", "file_path", "path", "pattern", "description", "prompt", "url"].find(
    (k) => typeof o[k] === "string"
  );
  const what = key ? String(o[key]) : JSON.stringify(input ?? "");
  return `[tool ${name}] ${clip(what, 160)}`;
}

/** One transcript item as a line of text, or null for what doesn't help a recap. */
function itemLine(item: TranscriptItem): string | null {
  switch (item.kind) {
    case "prompt":
      return `User: ${clip(item.text, MAX_ITEM)}`;
    case "reply":
      return `Agent: ${clip(item.text, MAX_ITEM)}`;
    case "toolCall":
      return toolLine(item.name, item.input);
    case "toolResult":
      return item.isError ? `[tool error] ${clip(item.text, 200)}` : null;
    case "command":
      return `User ran ${clip(item.text, 120)}`;
    case "notice":
      return `[note] ${clip(item.text, 200)}`;
    case "turnEnd":
      return "--- turn ended ---";
  }
}

/** The conversation as text, keeping the newest end within `max` characters. */
export function transcriptAsText(items: TranscriptItem[], max = MAX_TRANSCRIPT_CHARS): string {
  const lines: string[] = [];
  let size = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const line = itemLine(items[i]);
    if (line === null) continue;
    if (size + line.length + 1 > max) break;
    lines.push(line);
    size += line.length + 1;
  }
  return lines.reverse().join("\n");
}

/** The user message for one recap. */
export function buildRecapPrompt(
  previous: RecapText | null,
  conversation: string,
  note: string | null
): string {
  const parts: string[] = [];
  if (previous) {
    parts.push(
      `Previous recap:\nGoal: ${previous.goal}\nDone: ${previous.done}\nNow: ${previous.now}\nNext: ${previous.next}`
    );
  }
  if (note) parts.push(`The agent's own latest status note: ${clip(note, 300)}`);
  parts.push(
    `${previous ? "Conversation since that recap" : "The conversation"} (oldest first):\n${conversation}`
  );
  return parts.join("\n\n");
}

const LINE = /^[\s*_#>-]*(goal|done|now|next)[\s*_]*[:：-]\s*(.*)$/i;

/**
 * Read Haiku's four lines back. Null without a usable "Now", the line every
 * surface shows; a missing other line keeps the previous recap's.
 */
export function parseRecap(raw: string, previous: RecapText | null): RecapText | null {
  const found: Partial<RecapText> = {};
  for (const line of raw.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase() as keyof RecapText;
    const value = clip(m[2].replace(/\*\*/g, ""), MAX_FIELD);
    if (value && found[key] === undefined) found[key] = value;
  }
  if (!found.now) return null;
  return {
    goal: found.goal ?? previous?.goal ?? "",
    done: found.done ?? previous?.done ?? "",
    now: found.now,
    next: found.next ?? previous?.next ?? "",
  };
}
