// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fillKickoffTemplate } from "../agent/kickoffBrief.ts";
import { draftFields, draftFromIssue, draftTypeId, EMPTY_DRAFT } from "./cardDraft.ts";
import { resolveBriefTemplate, typePromptFor } from "./settings/brief.ts";
import { typeCardCount, typeMoveTargets, typeNameProblem } from "./settings/cardTypes.ts";
import {
  decideRepo,
  pickerRepos,
  startPromptRepos,
  toggleDefault,
  toggleRepo,
} from "./settings/repoChoice.ts";
import { TEMPLATES, templateById, templatePayload, templateSummary } from "./templates.ts";

const CATEGORIES = ["new", "indeterminate", "done"];
const PLACEHOLDER = /\{(\w+)\}/g;
const KNOWN = ["tracker", "key", "summary", "description", "comments", "type", "board"];

describe("board templates", () => {
  it("have valid columns, starting new and ending done", () => {
    for (const t of TEMPLATES) {
      assert.ok(t.columns.length >= 3, t.id);
      for (const c of t.columns) assert.ok(CATEGORIES.includes(c.category), `${t.id}: ${c.name}`);
      assert.equal(t.columns[0].category, "new", t.id);
      assert.equal(t.columns[t.columns.length - 1].category, "done", t.id);
      const names = t.columns.map((c) => c.name.toLowerCase());
      assert.equal(new Set(names).size, names.length, `${t.id}: column names repeat`);
    }
  });
  it("each has an in-progress column for auto-start, right after the first", () => {
    for (const t of TEMPLATES) {
      const first = t.columns.findIndex((c) => c.category === "indeterminate");
      assert.equal(first, 1, t.id);
    }
    // Bug triage starts work at Reproducing, not Fixing.
    assert.equal(templateById("triage").columns[1].name, "Reproducing");
  });
  it("have unique type names", () => {
    for (const t of TEMPLATES) {
      const names = t.cardTypes.map((c) => c.name.toLowerCase());
      assert.equal(new Set(names).size, names.length, t.id);
    }
  });
  it("write briefs with known placeholders, naming the card", () => {
    for (const t of TEMPLATES) {
      for (const brief of [t.prompt, ...t.cardTypes.map((c) => c.prompt)]) {
        if (!brief) continue;
        for (const [, name] of brief.matchAll(PLACEHOLDER)) {
          assert.ok(KNOWN.includes(name), `${t.id}: {${name}}`);
        }
        for (const needed of ["{key}", "{summary}", "{description}"]) {
          assert.ok(brief.includes(needed), `${t.id} lacks ${needed}`);
        }
      }
    }
  });
  it("Blank has no types and no prompt; ids are unique", () => {
    const blank = templateById("blank");
    assert.deepEqual(blank.cardTypes, []);
    assert.equal(blank.prompt, null);
    assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  });
  it("summarise in a line and send prompts only where set", () => {
    assert.equal(
      templateSummary(templateById("research")),
      "Questions → Investigating → Written up · Question, Spike"
    );
    assert.match(templateSummary(templateById("blank")), /no types$/);
    const payload = templatePayload(templateById("software"));
    assert.deepEqual(payload.cardTypes[0], { name: "Feature" });
    assert.ok(payload.cardTypes[1].prompt);
  });
});

describe("brief resolution", () => {
  const types = [
    { name: "Bug", prompt: "BUG {key}" },
    { name: "Feature", prompt: null },
  ];
  const global = "GLOBAL {key}";
  it("takes the type's prompt first", () => {
    const typePrompt = typePromptFor(types, "Bug");
    assert.equal(
      resolveBriefTemplate({ typePrompt, boardPrompt: "BOARD", globalTemplate: global }),
      "BUG {key}"
    );
  });
  it("then the board's", () => {
    const typePrompt = typePromptFor(types, "Feature");
    assert.equal(
      resolveBriefTemplate({ typePrompt, boardPrompt: "BOARD", globalTemplate: global }),
      "BOARD"
    );
    assert.equal(typePromptFor(types, "Task"), null);
  });
  it("then the global one, blank prompts counting as none", () => {
    assert.equal(
      resolveBriefTemplate({ typePrompt: "  ", boardPrompt: "", globalTemplate: global }),
      global
    );
    assert.equal(resolveBriefTemplate({ globalTemplate: global }), global);
  });
  it("fills a template's placeholders", () => {
    const template = templateById("software").cardTypes[1].prompt ?? "";
    const brief = fillKickoffTemplate(template, {
      tracker: "trace board",
      key: "local-3",
      summary: "Crash on save",
      description: "It crashes",
      comments: "(no comments yet)",
      type: "Bug",
      board: "App",
    });
    assert.match(brief, /^Fix bug local-3 on the App board: Crash on save/);
    assert.doesNotMatch(brief, /\{\w+\}/);
  });
});

describe("board repos at a start", () => {
  const all = ["/r/a", "/r/b", "/r/c"];
  it("say nothing without repos (today's rules)", () => {
    assert.deepEqual(decideRepo(null, all), { kind: "rules" });
    assert.deepEqual(decideRepo({ repos: [], defaultRepo: null }, all), { kind: "rules" });
    assert.deepEqual(pickerRepos(null, all), { repos: all, preselected: null });
  });
  it("use the one repo", () => {
    assert.deepEqual(decideRepo({ repos: ["/r/b"], defaultRepo: null }, all), {
      kind: "use",
      repo: "/r/b",
    });
  });
  it("use the default among several", () => {
    const board = { repos: ["/r/a", "/r/c"], defaultRepo: "/r/c" };
    assert.deepEqual(decideRepo(board, all), { kind: "use", repo: "/r/c" });
    assert.deepEqual(pickerRepos(board, all), { repos: ["/r/c", "/r/a"], preselected: "/r/c" });
  });
  it("ask among several without a default, offering only the board's", () => {
    const board = { repos: ["/r/a", "/r/c"], defaultRepo: null };
    assert.deepEqual(decideRepo(board, all), { kind: "pick", repos: ["/r/a", "/r/c"] });
    assert.deepEqual(pickerRepos(board, all), { repos: ["/r/a", "/r/c"], preselected: null });
  });
  it("ignore repos no longer configured", () => {
    const board = { repos: ["/gone", "/r/a"], defaultRepo: "/gone" };
    assert.deepEqual(decideRepo(board, all), { kind: "use", repo: "/r/a" });
  });
  it("keep a ticket's saved repo first in the Start prompt", () => {
    const board = { repos: ["/r/a", "/r/c"], defaultRepo: "/r/c" };
    assert.deepEqual(startPromptRepos(board, all, null), {
      repos: ["/r/c", "/r/a"],
      choice: "/r/c",
    });
    assert.deepEqual(startPromptRepos(board, all, "/r/b"), {
      repos: ["/r/b", "/r/c", "/r/a"],
      choice: "/r/b",
    });
    assert.deepEqual(startPromptRepos(null, all, null), { repos: all, choice: "/r/a" });
  });
  it("toggle repos and the default, which needs two or more", () => {
    let v = toggleRepo({ repos: [], defaultRepo: null }, "/r/a");
    v = toggleDefault(v, "/r/a");
    assert.equal(v.defaultRepo, null);
    v = toggleDefault(toggleRepo(v, "/r/b"), "/r/b");
    assert.deepEqual(v, { repos: ["/r/a", "/r/b"], defaultRepo: "/r/b" });
    assert.equal(toggleDefault(v, "/r/b").defaultRepo, null);
    assert.deepEqual(toggleRepo(v, "/r/b"), { repos: ["/r/a"], defaultRepo: null });
  });
});

describe("card types", () => {
  const types = [
    { id: "t1", name: "Feature" },
    { id: "t2", name: "Bug" },
  ];
  it("default a new card to the first type, an edited one to its own", () => {
    assert.equal(draftTypeId(EMPTY_DRAFT, types), "t1");
    assert.equal(draftTypeId(EMPTY_DRAFT, []), null);
    assert.equal(draftTypeId({ ...EMPTY_DRAFT, issueType: "Bug" }, types), "t2");
    assert.equal(draftTypeId({ ...EMPTY_DRAFT, issueType: "Task" }, types), null);
    assert.equal(draftTypeId({ ...EMPTY_DRAFT, issueType: "Bug", typeId: "t1" }, types), "t1");
  });
  it("send typeId only when there is one", () => {
    const draft = { ...EMPTY_DRAFT, summary: "x" };
    assert.equal(draftFields(draft, types).typeId, "t1");
    assert.equal("typeId" in draftFields(draft), false);
    const typeless = { ...draftFromIssueLike("Task"), summary: "x" };
    assert.equal("typeId" in draftFields(typeless, types), false);
  });
  it("keep names unique, ignoring case", () => {
    assert.equal(typeNameProblem(" ", types), "A type needs a name.");
    assert.match(typeNameProblem("bug", types) ?? "", /already/);
    assert.equal(typeNameProblem("Bug", types, "t2"), null);
    assert.equal(typeNameProblem("Chore", types), null);
  });
  it("count cards by type name and offer the other types", () => {
    const issues = [{ issueType: "Bug" }, { issueType: "Bug" }, { issueType: "Feature" }];
    assert.equal(typeCardCount(issues, "Bug"), 2);
    assert.deepEqual(typeMoveTargets(types, "t2"), [types[0]]);
  });
});

function draftFromIssueLike(issueType: string) {
  return draftFromIssue({
    id: "1",
    key: "local-1",
    summary: "s",
    statusId: "todo",
    statusName: "To do",
    statusCategory: "new",
    priority: "p2",
    issueType,
    labels: [],
  });
}
