import type { StatusCategory } from "../issues/types.ts";

// What a new board can start as: its columns, its card types and its brief. Data, not
// code, so the new-board dialog lists them and a test checks them. A brief uses the
// kickoff placeholders: {key} {summary} {description} {comments} {type} {board}
// ({tracker} works too, but on these boards it always reads "trace board"). A type's
// prompt replaces the board's brief for its cards, so it's a whole brief, and only
// where that kind of card really wants different work.

export type TemplateId = "software" | "research" | "triage" | "blank";

export interface TemplateColumn {
  name: string;
  category: StatusCategory;
}

export interface TemplateCardType {
  name: string;
  prompt?: string;
}

export interface BoardTemplateDef {
  id: TemplateId;
  label: string;
  columns: TemplateColumn[];
  cardTypes: TemplateCardType[];
  /** The board's kickoff brief; null leaves it on the global one. */
  prompt: string | null;
}

/** The part every brief opens with: what the card is, and what's been said about it. */
const header = (verb: string, body: string) =>
  `${verb} {key} on the {board} board: {summary}\n\n` +
  `${body}:\n{description}\n\n` +
  "Discussion so far:\n{comments}\n\n";

const SOFTWARE_BRIEF =
  header("Work on {type}", "Description") +
  "Implement it in this worktree, keeping the change to what the card asks for. Add or " +
  "update tests that cover it and run the project's tests before you finish. When they " +
  "pass, commit, push the branch and raise a pull request that says what changed and how " +
  "you tested it. If something is ambiguous, ask rather than build on a guess.";

const SOFTWARE_BUG =
  header("Fix bug", "What was reported") +
  "Reproduce it first: write a failing test that shows the bug, and check it fails for " +
  "the reason reported. Then fix the cause, not the symptom, and keep the test. Run the " +
  "project's tests, then commit, push and raise a pull request that explains the cause " +
  "and the fix. If you can't reproduce it, stop and say what you tried.";

const RESEARCH_BRIEF =
  header("Research {type}", "Details") +
  "Find the answer; don't change code unless the card asks you to. Read the code, docs " +
  "and history you need, try things in a scratch folder if that helps, and note where " +
  'each finding comes from. Publish what you found as a document titled "{key}: ' +
  '{summary}" (publish_document): the answer first, then the evidence, the options you ' +
  "weighed and what you recommend. Say plainly what you couldn't establish.";

const RESEARCH_SPIKE =
  header("Spike", "What to find out") +
  "Build the smallest throwaway prototype that answers the question, on this branch; " +
  'don\'t raise a pull request. Then publish a document titled "{key}: {summary}" ' +
  "(publish_document): what you tried, what worked, what didn't, and what doing it " +
  "properly would take.";

const TRIAGE_BRIEF =
  header("Triage {type}", "Report") +
  "Reproduce it before changing anything: write a failing test that shows the problem " +
  "and check it fails for the reason reported. If you can't reproduce it, stop and say " +
  "what you tried and what you'd need. Once it reproduces, find the cause, fix it, and " +
  "keep the test so it can't come back. Run the project's tests, then commit, push and " +
  "raise a pull request that explains the cause, the fix and the test.";

const TRIAGE_REGRESSION =
  header("Triage regression", "Report") +
  "This used to work. Reproduce it with a failing test first, then find the change that " +
  "broke it (git log, or git bisect with that test) and name the commit. Fix it in a way " +
  "that keeps what that change was for, keep the test, run the project's tests, then " +
  "commit, push and raise a pull request that names the commit and explains the fix.";

export const TEMPLATES: BoardTemplateDef[] = [
  {
    id: "software",
    label: "Software",
    columns: [
      { name: "To do", category: "new" },
      { name: "In progress", category: "indeterminate" },
      { name: "In review", category: "indeterminate" },
      { name: "Done", category: "done" },
    ],
    cardTypes: [{ name: "Feature" }, { name: "Bug", prompt: SOFTWARE_BUG }, { name: "Chore" }],
    prompt: SOFTWARE_BRIEF,
  },
  {
    id: "research",
    label: "Research",
    columns: [
      { name: "Questions", category: "new" },
      { name: "Investigating", category: "indeterminate" },
      { name: "Written up", category: "done" },
    ],
    cardTypes: [{ name: "Question" }, { name: "Spike", prompt: RESEARCH_SPIKE }],
    prompt: RESEARCH_BRIEF,
  },
  {
    id: "triage",
    label: "Bug triage",
    columns: [
      { name: "Reported", category: "new" },
      { name: "Reproducing", category: "indeterminate" },
      { name: "Fixing", category: "indeterminate" },
      { name: "Fixed", category: "done" },
    ],
    cardTypes: [{ name: "Bug" }, { name: "Regression", prompt: TRIAGE_REGRESSION }],
    prompt: TRIAGE_BRIEF,
  },
  {
    id: "blank",
    label: "Blank",
    columns: [
      { name: "To do", category: "new" },
      { name: "In progress", category: "indeterminate" },
      { name: "Done", category: "done" },
    ],
    cardTypes: [],
    prompt: null,
  },
];

export function templateById(id: TemplateId): BoardTemplateDef {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[TEMPLATES.length - 1];
}

/** What a template brings, in a line: "To do → In progress → Done · Feature, Bug". */
export function templateSummary(t: BoardTemplateDef): string {
  const columns = t.columns.map((c) => c.name).join(" → ");
  const types = t.cardTypes.length > 0 ? t.cardTypes.map((c) => c.name).join(", ") : "no types";
  return `${columns} · ${types}`;
}

/** The template as `custom_board_create` takes it (a type's prompt only when it has one). */
export function templatePayload(t: BoardTemplateDef): {
  columns: TemplateColumn[];
  cardTypes: TemplateCardType[];
} {
  return {
    columns: t.columns.map((c) => ({ ...c })),
    cardTypes: t.cardTypes.map((c) =>
      c.prompt ? { name: c.name, prompt: c.prompt } : { name: c.name }
    ),
  };
}
