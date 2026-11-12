import type Anthropic from "@anthropic-ai/sdk";
import { useBoardStore } from "@/domains/board/store";
import { applyBoardData } from "@/domains/boards/boardEdits";
import { loadBoard } from "@/domains/orchestrator/boardLookup";
import { matchName, noColumnMessage, normalizeKey } from "@/domains/orchestrator/boardRef";
import { type CardFields, createCustomCard, updateCustomCard } from "@/ipc/customBoards";
import { getBoard, listBoards } from "@/ipc/issues";
import { str } from "./args";
import { parseLabels, parsePriority, pickCustomBoard } from "./cardArgs";

// Cards on trace's own boards, which agents may create and edit. Board and column
// structure stays the user's, so there are no tools for it. Defined here, but they are
// write tools like the orchestrator's: `writeTools.ts` lists them, so the assistant puts
// each behind its confirm card and agents run them straight away.

const CARD_FIELDS = {
  description: { type: "string", description: "The card's text (plain text or Markdown)." },
  priority: {
    type: "string",
    description: "p0 (highest), p1, p2 or p3 (lowest); or Highest, High, Medium, Low.",
  },
  labels: { type: "array", items: { type: "string" }, description: "The card's labels." },
} as const;

export const CARD_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_card",
    description:
      "Create a card on one of trace's own boards (not Jira or Pylon: those are changed in their tracker). Returns its key, like local-12.",
    input_schema: {
      type: "object",
      properties: {
        board: {
          type: "string",
          description:
            "The board: custom:<id> or its name, as list_boards shows. May be left out when there is only one trace board.",
        },
        summary: { type: "string", description: "The card's title." },
        column: {
          type: "string",
          description: "The column to put it in, by name. The board's first column when left out.",
        },
        ...CARD_FIELDS,
      },
      required: ["summary"],
    },
  },
  {
    name: "update_card",
    description:
      "Change a card on one of trace's own boards: its title, text, priority or labels. Fields left out stay as they are; labels replace the card's labels. To move a card use move_issue.",
    input_schema: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "The card's key, e.g. local-12." },
        summary: { type: "string", description: "The new title." },
        ...CARD_FIELDS,
      },
      required: ["issue_key"],
    },
  },
];

export const CARD_TOOL_NAMES = new Set(CARD_TOOLS.map((t) => t.name));

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The confirm card's line for a card tool. */
export function cardActionSummary(name: string, input: unknown): string {
  if (name === "create_card") {
    const board = str(input, "board");
    return `Create card "${clip(str(input, "summary"), 60)}"${board ? ` on ${board}` : ""}`;
  }
  return `Update ${normalizeKey(str(input, "issue_key"))}`;
}

/** Show a trace board's fresh data if it is the one on screen (a no-op otherwise). */
async function showIfLoaded(boardId: string): Promise<void> {
  await getBoard("custom", boardId)
    .then(applyBoardData)
    .catch(() => undefined);
}

/** The fields a call names, so only those are sent (and, on an update, only those change). */
function changedFields(input: unknown): Partial<CardFields> {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const fields: Partial<CardFields> = {};
  const summary = str(input, "summary");
  if (summary) fields.summary = summary;
  if (typeof raw.description === "string") fields.description = raw.description;
  const priority = parsePriority(raw.priority);
  if (priority) fields.priority = priority;
  const labels = parseLabels(raw.labels);
  if (labels) fields.labels = labels;
  return fields;
}

async function createCard(input: unknown): Promise<string> {
  const summary = str(input, "summary");
  if (!summary) return "Error: give a summary for the card.";
  const board = pickCustomBoard(await listBoards("custom"), str(input, "board"));
  const { data } = await loadBoard(`custom:${board.id}`);
  const wanted = str(input, "column");
  const column = wanted ? matchName(data.columns, wanted, (c) => c.name) : undefined;
  if (wanted && !column) return noColumnMessage(data.columns, wanted);
  const fields = changedFields(input);
  const issue = await createCustomCard(board.id, {
    ...fields,
    summary,
    columnId: column?.statuses[0]?.id,
  });
  await showIfLoaded(board.id);
  return `Created ${issue.key} "${summary}" on ${board.name} (custom:${board.id}), in ${column?.name ?? data.columns[0]?.name ?? "its first column"}.`;
}

async function updateCard(input: unknown): Promise<string> {
  const key = normalizeKey(str(input, "issue_key"));
  if (!key) return "Error: missing issue_key.";
  if (!/^local-\d+$/.test(key)) {
    return `${key} isn't on a trace board: only cards like local-12 can be edited here (Jira and Pylon tickets are changed in their tracker).`;
  }
  const fields = changedFields(input);
  if (Object.keys(fields).length === 0)
    return "Nothing to change: give summary, description, priority or labels.";
  await updateCustomCard(key, fields);
  const shown = useBoardStore.getState().data;
  if (shown?.issues.some((i) => i.key === key)) await showIfLoaded(shown.boardId);
  return `Updated ${key}: ${Object.keys(fields).join(", ")}.`;
}

/** Run a card tool; failures come back as the sentence for the model. */
export async function runCardTool(name: string, input: unknown): Promise<string> {
  try {
    return name === "create_card" ? await createCard(input) : await updateCard(input);
  } catch (e) {
    return `Couldn't ${name === "create_card" ? "create the card" : "update the card"}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
