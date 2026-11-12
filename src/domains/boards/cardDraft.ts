import type { Issue, Priority } from "../issues/types.ts";

// A custom card as its form holds it: plain strings while typing, turned into the
// command's fields on save. Labels are typed as one comma-separated line. Its type is
// one of the board's card types; they load after the form opens, so the draft keeps
// only a choice the user made, and the default is worked out against the types.

export interface CardDraft {
  summary: string;
  description: string;
  priority: Priority;
  /** Comma-separated, as typed. */
  labels: string;
  /** The type picked in the form; null until one is (the default applies). */
  typeId: string | null;
  /** The card's type name as it was, when editing one (types are matched by name). */
  issueType?: string;
}

/** The fields a card's form saves (the IPC's `CardFields`, all of them set). */
export interface CardDraftFields {
  summary: string;
  description: string;
  priority: Priority;
  labels: string[];
  /** Only when the board has types and the card has one. */
  typeId?: string;
}

/** A card type as the form needs it. */
export interface DraftType {
  id: string;
  name: string;
}

/** Priorities, highest first, with the words the ticket view uses. */
export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "p0", label: "Highest" },
  { value: "p1", label: "High" },
  { value: "p2", label: "Medium" },
  { value: "p3", label: "Low" },
];

export const EMPTY_DRAFT: CardDraft = {
  summary: "",
  description: "",
  priority: "p2",
  labels: "",
  typeId: null,
};

/** A card's current fields, ready to edit. */
export function draftFromIssue(issue: Issue): CardDraft {
  return {
    summary: issue.summary,
    description: issue.description ?? "",
    priority: issue.priority,
    labels: issue.labels.join(", "),
    typeId: null,
    issueType: issue.issueType,
  };
}

/** The draft's type: the one picked, else the card's own (by name) when editing, else
 * the board's first. Null for a card with no type, or a board without types. */
export function draftTypeId(draft: CardDraft, types: DraftType[]): string | null {
  if (draft.typeId && types.some((t) => t.id === draft.typeId)) return draft.typeId;
  if (draft.issueType !== undefined) {
    return types.find((t) => t.name === draft.issueType)?.id ?? null;
  }
  return types[0]?.id ?? null;
}

/** Labels from a comma-separated line: trimmed, inner spaces kept, empties and repeats gone. */
export function parseLabels(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const label = part.trim().replace(/\s+/g, " ");
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Why the draft can't be saved, or null when it can. Only the summary is required. */
export function draftProblem(draft: CardDraft): string | null {
  if (draft.summary.trim() === "") return "A card needs a summary.";
  return null;
}

/** What to send: trimmed text, parsed labels, the type when there is one. An empty
 * description clears it; a card left with no type keeps none (`typeId` left out). */
export function draftFields(draft: CardDraft, types: DraftType[] = []): CardDraftFields {
  const fields: CardDraftFields = {
    summary: draft.summary.trim(),
    description: draft.description.trim(),
    priority: draft.priority,
    labels: parseLabels(draft.labels),
  };
  const typeId = draftTypeId(draft, types);
  return typeId ? { ...fields, typeId } : fields;
}
