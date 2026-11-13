// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addAgentBlocker,
  hostHint,
  hostId,
  hostPlace,
  PEER_NO_AGENTS,
  SANDBOX_NO_AGENTS,
  SANDBOX_POLL_FAST_MS,
  SANDBOX_POLL_MS,
  sandboxFacts,
  sandboxPollMs,
  sandboxRepoNote,
  sandboxRepos,
  sandboxStatusLabel,
  timeLeft,
} from "./sessionHost.ts";
import type { ScratchSession } from "./types.ts";

const session = (over: Partial<ScratchSession> = {}): ScratchSession => ({
  id: "s1",
  title: "Spike",
  cli: "claude",
  createdAt: 0,
  ...over,
});
const vercel = (remote: string | null) => ({
  kind: "vercel" as const,
  sandbox: "trace-s1",
  remote,
});

describe("addAgentBlocker", () => {
  it("lets a local session under the cap add one", () => {
    assert.equal(addAgentBlocker(session(), 4), null);
    assert.equal(addAgentBlocker(session({ agents: [{ id: "a", cli: "codex" }] }), 4), null);
  });
  it("stops a local session at the cap", () => {
    const agents = [1, 2].map((n) => ({ id: `a${n}`, cli: "codex" as const }));
    assert.match(addAgentBlocker(session({ agents }), 2) ?? "", /maximum/);
  });
  it("always blocks a sandbox session, saying why", () => {
    assert.equal(addAgentBlocker(session({ host: vercel("o/n") }), 4), SANDBOX_NO_AGENTS);
  });
});

describe("hostHint", () => {
  it("names the repo the sandbox cloned", () => {
    assert.equal(
      hostHint(vercel("noble1911/trace")),
      "Runs in a Vercel Sandbox cloned from noble1911/trace, not on this computer."
    );
  });
  it("never claims the repo root without a remote", () => {
    assert.doesNotMatch(hostHint(vercel(null)), /repo root/);
  });
});

describe("hostPlace", () => {
  it("names the sandbox and the repo it cloned", () => {
    assert.equal(hostPlace(vercel("noble1911/trace")), "Vercel Sandbox · noble1911/trace");
  });
  it("falls back to the sandbox's name", () => {
    assert.equal(hostPlace(vercel(null)), "Vercel Sandbox · trace-s1");
  });
});

describe("a session on a peer", () => {
  const peer = { kind: "peer" as const, peer: "p1", repo: "widgets", remoteId: "s9" };
  it("says it's another computer, and which repo", () => {
    assert.equal(hostPlace(peer), "Another computer · widgets");
    assert.equal(hostPlace({ ...peer, repo: null }), "Another computer");
    assert.equal(hostId(peer), "s9");
  });
  it("can't take extra agents yet", () => {
    assert.equal(addAgentBlocker(session({ host: peer }), 4), PEER_NO_AGENTS);
  });
});

describe("sandboxStatusLabel", () => {
  it("says it's the sandbox's state, not the agent's", () => {
    assert.equal(sandboxStatusLabel("running"), "Sandbox running");
    assert.equal(sandboxStatusLabel("STOPPED"), "Sandbox stopped");
    assert.equal(sandboxStatusLabel(""), "Sandbox");
  });
});

describe("sandboxRepos", () => {
  const gh = { host: "github.com", owner: "o", name: "n" };
  it("keeps only repos with a GitHub origin, in order", () => {
    const repos = [
      { path: "/a", remote: gh },
      { path: "/b", remote: null },
      { path: "/c", remote: { ...gh, host: "gitlab.com" } },
      { path: "/d", remote: { ...gh, host: "GitHub.com" } },
    ];
    assert.deepEqual(sandboxRepos(repos), { usable: ["/a", "/d"], skipped: ["/b", "/c"] });
  });
});

describe("sandboxRepoNote", () => {
  it("names the repos left out, and why", () => {
    const note = sandboxRepoNote({ usable: ["web"], skipped: ["notes", "infra"] });
    assert.match(note, /no GitHub origin: notes, infra\.$/);
  });
  it("says how to get a repo when none can run", () => {
    assert.match(sandboxRepoNote({ usable: [], skipped: ["notes"] }), /none of yours/);
    assert.match(sandboxRepoNote({ usable: [], skipped: [] }), /Settings → Repositories/);
  });
  it("says it's still checking", () => {
    assert.match(sandboxRepoNote(null), /Checking/);
  });
});

describe("timeLeft", () => {
  it("reads in minutes, then hours", () => {
    assert.equal(timeLeft(30_000), "under a minute");
    assert.equal(timeLeft(32 * 60_000 + 5_000), "32 min");
    assert.equal(timeLeft(65 * 60_000), "1 h 5 min");
    assert.equal(timeLeft(120 * 60_000), "2 h");
  });
});

describe("sandboxFacts", () => {
  const now = 1_000_000_000;
  const base = { status: "running", saved: false, stopsAt: null, savedUntil: null };
  it("tells attached from unattended, with the time left", () => {
    const stopsAt = now + 32 * 60_000;
    assert.deepEqual(sandboxFacts({ ...base, stopsAt }, true, now), {
      state: "Running",
      detail: "Vercel stops it in 32 min.",
    });
    const away = sandboxFacts({ ...base, stopsAt }, false, now);
    assert.equal(away.state, "Running unattended");
    assert.match(away.detail, /32 min/);
  });
  it("says what keeps it alive when Vercel gives no time", () => {
    assert.match(sandboxFacts(base, false, now).detail, /time limit/);
  });
  it("calls a stopped sandbox with a snapshot saved, and says for how long", () => {
    const saved = { ...base, status: "stopped", saved: true, savedUntil: now + 6.5 * 86_400_000 };
    const facts = sandboxFacts(saved, false, now);
    assert.equal(facts.state, "Saved");
    assert.match(facts.detail, /6 more days/);
  });
  it("calls it expired with no snapshot, or one past its expiry", () => {
    const stopped = { ...base, status: "stopped" };
    assert.equal(sandboxFacts(stopped, false, now).state, "Expired");
    const old = { ...stopped, saved: true, savedUntil: now - 1 };
    assert.equal(sandboxFacts(old, false, now).state, "Expired");
  });
  it("names the passing states and a missing sandbox", () => {
    assert.equal(sandboxFacts({ ...base, status: "snapshotting" }, false, now).state, "Saving");
    assert.equal(sandboxFacts({ ...base, status: "pending" }, false, now).state, "Starting");
    assert.equal(sandboxFacts({ ...base, status: "" }, false, now).state, "No sandbox");
    assert.equal(sandboxFacts({ ...base, status: "failed" }, false, now).state, "Sandbox failed");
  });
});

describe("sandboxPollMs", () => {
  it("asks again soon while the sandbox is on its way", () => {
    assert.equal(sandboxPollMs(null, false), SANDBOX_POLL_FAST_MS);
    assert.equal(sandboxPollMs("pending", true), SANDBOX_POLL_FAST_MS);
    assert.equal(sandboxPollMs("snapshotting", false), SANDBOX_POLL_FAST_MS);
  });
  it("asks again soon when the agent runs but no sandbox is reported yet", () => {
    assert.equal(sandboxPollMs("", true), SANDBOX_POLL_FAST_MS);
  });
  it("settles to once a minute", () => {
    assert.equal(sandboxPollMs("running", true), SANDBOX_POLL_MS);
    assert.equal(sandboxPollMs("stopped", false), SANDBOX_POLL_MS);
    assert.equal(sandboxPollMs("", false), SANDBOX_POLL_MS);
  });
});
