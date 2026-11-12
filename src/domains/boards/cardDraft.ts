import type { Issue, Priority } from "../issues/types.ts";

// A custom card as its form holds it: plain strings while typing, turned into the
// command's fields on save. Labels are typed as one comma-separated line.

export interface CardDraft {
  summary: string;
  description: string;
  priority: Priority;
  /** Comma-separated, as typed. */
  labels: string;
}

/** The fields a card's form saves (the IPC's `CardFields`, all of them set). */
export interface CardDraftFields {
  summary: string;
  description: string;
  priority: Priority;
  labels: string[];
}

/** Priorities, highest first, with the words the ticket view uses. */
export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "p0", label: "Highest" },
  { value: "p1", label: "High" },
  { value: "p2", label: "Medium" },
  { value: "p3", label: "Low" },
];

export const EMPTY_DRAFT: CardDraft = { summary: "", description: "", priority: "p2", labels: "" };

/** A card's current fields, ready to edit. */
export function draftFromIssue(issue: Issue): CardDraft {
  return {
    summary: issue.summary,
    description: issue.description ?? "",
    priority: issue.priority,
    labels: issue.labels.join(", "),
  };
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

/** What to send: trimmed text, parsed labels. An empty description clears it. */
export function draftFields(draft: CardDraft): CardDraftFields {
  return {
    summary: draft.summary.trim(),
    description: draft.description.trim(),
    priority: draft.priority,
    labels: parseLabels(draft.labels),
  };
}
