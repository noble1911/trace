// Mock data for ClaudeOrchestrator
// Each "agent" is a chat session paired 1:1 with a ticket.

const AGENTS = [
  { id: "aura",   color: "oklch(0.78 0.15 70)",  initial: "A" },
  { id: "bolt",   color: "oklch(0.72 0.16 290)", initial: "B" },
  { id: "cinder", color: "oklch(0.68 0.18 25)",  initial: "C" },
  { id: "delta",  color: "oklch(0.74 0.14 155)", initial: "D" },
  { id: "echo",   color: "oklch(0.78 0.13 200)", initial: "E" },
  { id: "flux",   color: "oklch(0.76 0.15 330)", initial: "F" },
  { id: "gale",   color: "oklch(0.80 0.12 100)", initial: "G" },
  { id: "halo",   color: "oklch(0.72 0.14 250)", initial: "H" },
  { id: "iris",   color: "oklch(0.74 0.16 350)", initial: "I" },
  { id: "juno",   color: "oklch(0.78 0.14 130)", initial: "J" },
];

const TICKETS = [
  {
    id: "CLD-142",
    title: "Stream tokens from /v1/chat with backpressure",
    status: "in_progress",
    priority: "p1",
    agent: "aura",
    branch: "aura/stream-tokens",
    activity: "writing 3 min ago",
    state: "thinking", // thinking | waiting | idle
    filesChanged: 7,
    diff: { add: 184, del: 41 },
    progress: 0.62,
    pr: null,
    preview: "Routing through ReadableStream now, but server-sent events feel cleaner for the dashboard client...",
    labels: ["api", "perf"],
    epic: "Streaming v2",
    reporter: "marin",
    estimate: "5d",
    description: [
      "Switch /v1/chat to incremental token streaming so the dashboard renders mid-response.",
      "Use either Server-Sent Events or a chunked ReadableStream — pick whichever degrades best for our oldest mobile clients.",
      "Apply backpressure when the consumer is slow (esp. mobile) — drop to summary tokens rather than buffering unbounded.",
    ],
    criteria: [
      { done: true,  text: "Wire ReadableStream pipeline through edge worker" },
      { done: true,  text: "Add E2E test for slow-consumer backpressure" },
      { done: false, text: "Telemetry: stream-latency p50/p95 in Datadog" },
      { done: false, text: "Feature-flag rollout: 1% → 10% → 100%" },
    ],
  },
  {
    id: "CLD-141",
    title: "Webhook retry with exponential backoff + DLQ",
    status: "in_progress",
    priority: "p1",
    agent: "flux",
    branch: "flux/webhook-retry",
    activity: "waiting for input",
    state: "waiting",
    filesChanged: 4,
    diff: { add: 92, del: 18 },
    progress: 0.45,
    pr: null,
    preview: "Should the DLQ TTL be 7 days (matches Stripe) or 14 days (matches our SLA)? Need your call before continuing.",
    labels: ["infra", "reliability"],
    epic: "Outbound webhooks",
    reporter: "kai",
    estimate: "3d",
    description: [
      "Outbound webhooks currently retry 3 times with fixed 1s delay and silently drop.",
      "Replace with exponential backoff (1s, 4s, 16s, 64s, 256s) and route final failures to a dead-letter queue.",
    ],
    criteria: [
      { done: true,  text: "Backoff schedule lives in config, not code" },
      { done: false, text: "DLQ readable from admin panel" },
      { done: false, text: "Replay endpoint with auth scope `webhooks:replay`" },
    ],
  },
  {
    id: "CLD-138",
    title: "Fix race condition in session manager on token refresh",
    status: "review",
    priority: "p0",
    agent: "bolt",
    branch: "bolt/session-race",
    activity: "PR open · 12m ago",
    state: "idle",
    filesChanged: 3,
    diff: { add: 47, del: 22 },
    progress: 1,
    pr: { num: 4821, status: "open", reviews: 1, checks: { pass: 6, fail: 0, pending: 1 } },
    preview: "Lock-free refresh now serialized through an in-flight Promise. All flake tests green for 50 runs.",
    labels: ["bug", "auth"],
    epic: "Auth hardening",
    reporter: "marin",
    estimate: "2d",
    description: [
      "Two parallel requests during token expiry can each trigger a refresh, racing on the cookie write.",
      "The losing write produces a malformed JWT that ~0.4% of users hit (sentry CLD-7821).",
    ],
    criteria: [
      { done: true, text: "Refresh is serialized via in-flight promise cache" },
      { done: true, text: "Regression test reproduces the race deterministically" },
      { done: true, text: "Sentry: drop CLD-7821 to <0.01% in canary" },
    ],
  },
  {
    id: "CLD-139",
    title: "Cut bundle size — split vendor + lazy-load editor",
    status: "review",
    priority: "p2",
    agent: "gale",
    branch: "gale/bundle-split",
    activity: "PR open · 1h ago",
    state: "idle",
    filesChanged: 11,
    diff: { add: 230, del: 312 },
    progress: 1,
    pr: { num: 4818, status: "open", reviews: 0, checks: { pass: 5, fail: 1, pending: 0 } },
    preview: "Down from 1.4MB → 640KB initial. One Playwright assertion broke — needs human eye.",
    labels: ["perf", "frontend"],
    epic: "Perf budget Q3",
    reporter: "lex",
    estimate: "3d",
    description: [
      "Initial JS payload is 1.4MB gzipped — kills first-paint on 3G.",
      "Split vendor chunks, lazy-load the Monaco editor, and tree-shake lodash.",
    ],
    criteria: [
      { done: true,  text: "Initial JS ≤ 700KB gzipped on /dashboard" },
      { done: true,  text: "Monaco loaded only on /editor routes" },
      { done: false, text: "Playwright regression suite green" },
    ],
  },
  {
    id: "CLD-145",
    title: "Refactor auth middleware to use AsyncLocalStorage",
    status: "todo",
    priority: "p2",
    agent: "cinder",
    branch: "—",
    activity: "queued",
    state: "idle",
    filesChanged: 0,
    diff: { add: 0, del: 0 },
    progress: 0,
    pr: null,
    preview: null,
    labels: ["refactor", "auth"],
    epic: "Auth hardening",
    reporter: "marin",
    estimate: "4d",
  },
  {
    id: "CLD-147",
    title: "Add OpenTelemetry traces to ingest pipeline",
    status: "todo",
    priority: "p2",
    agent: "echo",
    branch: "—",
    activity: "queued",
    state: "idle",
    filesChanged: 0,
    diff: { add: 0, del: 0 },
    progress: 0,
    pr: null,
    preview: null,
    labels: ["observability"],
    epic: "Observability",
    reporter: "kai",
    estimate: "3d",
  },
  {
    id: "CLD-149",
    title: "Migrate feature flags from LaunchDarkly to internal service",
    status: "todo",
    priority: "p3",
    agent: "iris",
    branch: "—",
    activity: "queued",
    state: "idle",
    filesChanged: 0,
    diff: { add: 0, del: 0 },
    progress: 0,
    pr: null,
    preview: null,
    labels: ["migration"],
    epic: "Cost reduction",
    reporter: "lex",
    estimate: "8d",
  },
  {
    id: "CLD-130",
    title: "Migrate primary DB from Postgres 14 → 16",
    status: "done",
    priority: "p1",
    agent: "delta",
    branch: "delta/pg16",
    activity: "merged 2d ago",
    state: "idle",
    filesChanged: 18,
    diff: { add: 412, del: 178 },
    progress: 1,
    pr: { num: 4801, status: "merged", reviews: 2, checks: { pass: 8, fail: 0, pending: 0 } },
    preview: null,
    labels: ["infra"],
    epic: "Infra Q3",
    reporter: "marin",
    estimate: "5d",
  },
  {
    id: "CLD-128",
    title: "Docker multi-stage build (shave 480MB)",
    status: "done",
    priority: "p3",
    agent: "halo",
    branch: "halo/docker-multistage",
    activity: "merged 3d ago",
    state: "idle",
    filesChanged: 2,
    diff: { add: 54, del: 23 },
    progress: 1,
    pr: { num: 4789, status: "merged", reviews: 1, checks: { pass: 7, fail: 0, pending: 0 } },
    preview: null,
    labels: ["infra", "docker"],
    epic: "Infra Q3",
    reporter: "kai",
    estimate: "1d",
  },
  {
    id: "CLD-125",
    title: "Stripe → internal subscription state reconciler",
    status: "done",
    priority: "p1",
    agent: "juno",
    branch: "juno/stripe-sync",
    activity: "merged 5d ago",
    state: "idle",
    filesChanged: 9,
    diff: { add: 318, del: 47 },
    progress: 1,
    pr: { num: 4762, status: "merged", reviews: 2, checks: { pass: 8, fail: 0, pending: 0 } },
    preview: null,
    labels: ["billing"],
    epic: "Billing reliability",
    reporter: "marin",
    estimate: "5d",
  },
];

// ====== Agent-specific chat transcripts (for full-screen view) ======
const TRANSCRIPTS = {
  "CLD-142": [
    { who: "human", name: "You", time: "1h ago", body: [
      { p: "Pick up CLD-142 — stream tokens from /v1/chat. The dashboard team needs incremental render. Match the chunked pattern in /v1/embed if it fits." }
    ]},
    { who: "agent", name: "aura", time: "1h ago", body: [
      { p: "Read /v1/embed and /v1/chat. embed uses chunked transfer with a custom length prefix — works but the dashboard client wants SSE-style events to differentiate token/tool-use/done frames." },
      { p: "Going to expose three event types — token, tool_call, done — over Server-Sent Events. Falling back to chunked-JSON for any UA that fails the SSE preflight." },
      { tool: "read_files", target: "src/api/chat.ts, src/api/embed.ts" },
    ]},
    { who: "agent", name: "aura", time: "44m ago", body: [
      { p: "Wired the ReadableStream → SSE encoder. Edge worker streams cleanly. Wrote a slow-consumer test using a TransformStream with a 200ms delay between reads — backpressure now propagates and the upstream LLM call pauses." },
      { code:
"export function toSSE(stream: ReadableStream<TokenEvent>) {\n  return stream.pipeThrough(new TransformStream({\n    transform(ev, ctl) {\n      ctl.enqueue(`event: ${ev.type}\\ndata: ${JSON.stringify(ev.data)}\\n\\n`);\n    }\n  }));\n}" },
    ]},
    { who: "agent", name: "aura", time: "12m ago", body: [
      { p: "Running the e2e suite. 23/24 passing; the failure is the iOS Safari 15 test — SSE works but the EventSource ping interval is too aggressive." },
      { tool: "run_tests", target: "tests/e2e/stream", result: "23 / 24 passed" },
      { p: "Lowering ping to 25s for that UA class. Re-running." },
    ]},
    { who: "agent", name: "aura", time: "3m ago", body: [
      { p: "All 24 green. Datadog dashboard for stream-latency is half-built — need a metric name from your side. `chat.stream.token.latency` ok?" },
    ]},
  ],
  "CLD-141": [
    { who: "human", name: "You", time: "3h ago", body: [
      { p: "Add real retry to outbound webhooks. The current 3×1s thing is embarrassing." },
    ]},
    { who: "agent", name: "flux", time: "3h ago", body: [
      { p: "Read the webhook dispatcher. Pulling backoff schedule into config now, and adding the DLQ table." },
      { tool: "read_files", target: "src/webhooks/dispatcher.ts" },
    ]},
    { who: "agent", name: "flux", time: "2h ago", body: [
      { p: "Backoff config + DLQ table added. Replay endpoint draft is in place behind `webhooks:replay` scope." },
      { p: "One open question before I keep going: **DLQ retention.** Stripe uses 7 days; your SLA contract promises 14. Which one wins here? It affects storage cost more than anything." },
    ]},
    { who: "system", name: "system", time: "2h ago", body: [
      { p: "Agent moved to WAITING — human input required." },
    ]},
  ],
  "CLD-138": [
    { who: "human", name: "You", time: "1d ago", body: [
      { p: "P0: token-refresh race in session manager. Repro is in sentry CLD-7821. Fix and ship." },
    ]},
    { who: "agent", name: "bolt", time: "1d ago", body: [
      { p: "Found it. Two requests entering `refreshSession()` near-simultaneously both call the OAuth endpoint and write the cookie. Whichever returns second corrupts the JWT envelope." },
      { p: "Fix: serialize on a shared in-flight Promise keyed by userId. Returns the same Promise to all concurrent callers." },
      { code:
"const inflight = new Map<string, Promise<Session>>();\n\nexport function refreshSession(uid: string) {\n  let p = inflight.get(uid);\n  if (p) return p;\n  p = doRefresh(uid).finally(() => inflight.delete(uid));\n  inflight.set(uid, p);\n  return p;\n}" },
    ]},
    { who: "agent", name: "bolt", time: "22h ago", body: [
      { p: "Wrote a deterministic regression — fires 50 parallel refreshes, asserts exactly 1 OAuth call. Was failing 12/50 on main, now 0/50. Ran the loop 100× clean." },
      { tool: "run_tests", target: "session-manager.spec.ts", result: "100 / 100 runs clean" },
    ]},
    { who: "agent", name: "bolt", time: "12m ago", body: [
      { p: "PR #4821 open. 6/7 checks green; security-scan still pending but should clear in ~3m. Ready for your review." },
    ]},
  ],
  "CLD-145": [
    { who: "system", name: "system", time: "—", body: [
      { p: "Agent queued. Send the first message to begin." }
    ]},
  ],
  "CLD-147": [
    { who: "system", name: "system", time: "—", body: [
      { p: "Agent queued. Send the first message to begin." }
    ]},
  ],
  "CLD-149": [
    { who: "system", name: "system", time: "—", body: [
      { p: "Agent queued. Send the first message to begin." }
    ]},
  ],
};

// ====== Mock file-tree for one agent (used in detail view) ======
const FILE_TREES = {
  "CLD-142": [
    { group: "Modified" },
    { path: "src/api/chat.ts", add: 84, del: 32, active: true },
    { path: "src/api/_sse.ts", add: 41, del: 0, kind: "new" },
    { path: "src/api/embed.ts", add: 6, del: 4 },
    { path: "src/edge/worker.ts", add: 22, del: 5 },
    { path: "tests/e2e/stream.spec.ts", add: 31, del: 0, kind: "new" },
    { group: "Untested" },
    { path: "src/api/types.ts", add: 0, del: 0 },
    { group: "Config" },
    { path: "wrangler.toml", add: 2, del: 0 },
  ],
};

// ====== Diff for active file ======
const ACTIVE_DIFF = {
  path: "src/api/chat.ts",
  add: 84, del: 32,
  hunks: [
    { header: "@@ -42,7 +42,18 @@ export async function POST(req: Request) {",
      lines: [
        { kind: "ctx", a: 42, b: 42, text: "  const session = await requireSession(req);" },
        { kind: "ctx", a: 43, b: 43, text: "  const body = await req.json();" },
        { kind: "ctx", a: 44, b: 44, text: "" },
        { kind: "del", a: 45,        text: "  const result = await llm.complete(body);" },
        { kind: "del", a: 46,        text: "  return Response.json(result);" },
        { kind: "add",        b: 45, text: "  const stream = await llm.stream(body, {" },
        { kind: "add",        b: 46, text: "    onTokenDrop: () => metrics.incr('chat.stream.dropped')," },
        { kind: "add",        b: 47, text: "  });" },
        { kind: "add",        b: 48, text: "" },
        { kind: "add",        b: 49, text: "  return new Response(toSSE(stream), {" },
        { kind: "add",        b: 50, text: "    headers: {" },
        { kind: "add",        b: 51, text: "      'content-type': 'text/event-stream'," },
        { kind: "add",        b: 52, text: "      'cache-control': 'no-store'," },
        { kind: "add",        b: 53, text: "      'x-accel-buffering': 'no'," },
        { kind: "add",        b: 54, text: "    }," },
        { kind: "add",        b: 55, text: "  });" },
        { kind: "ctx", a: 47, b: 56, text: "}" },
      ]
    },
    { header: "@@ -88,3 +99,14 @@ function buildPrompt(messages: Message[]) {",
      lines: [
        { kind: "ctx", a: 88, b: 99, text: "  return prompt;" },
        { kind: "ctx", a: 89, b: 100, text: "}" },
        { kind: "ctx", a: 90, b: 101, text: "" },
        { kind: "add",        b: 102, text: "// Honour the slow-consumer signal — degrade to summary tokens" },
        { kind: "add",        b: 103, text: "// rather than buffering unbounded in front of the LLM call." },
        { kind: "add",        b: 104, text: "export function withBackpressure(stream: ReadableStream) {" },
        { kind: "add",        b: 105, text: "  return stream.pipeThrough(new TransformStream({" },
        { kind: "add",        b: 106, text: "    async transform(chunk, ctl) {" },
        { kind: "add",        b: 107, text: "      if (ctl.desiredSize !== null && ctl.desiredSize < 0) {" },
        { kind: "add",        b: 108, text: "        await new Promise(r => setTimeout(r, 50));" },
        { kind: "add",        b: 109, text: "      }" },
        { kind: "add",        b: 110, text: "      ctl.enqueue(chunk);" },
        { kind: "add",        b: 111, text: "    }," },
        { kind: "add",        b: 112, text: "  }));" },
        { kind: "add",        b: 113, text: "}" },
      ]
    }
  ]
};

// ====== Terminal output ======
const TERMINAL_LOG = [
  { kind: "prompt", text: "aura@workspace:~/api$ pnpm test stream" },
  { kind: "dim",    text: "> claude-orch@1.4.0 test" },
  { kind: "dim",    text: "> vitest run --include tests/e2e/stream" },
  { kind: "plain",  text: "" },
  { kind: "plain",  text: " RUN  v1.6.0 /workspace/api" },
  { kind: "plain",  text: "" },
  { kind: "ok",     text: " ✓ tests/e2e/stream.basic.spec.ts (6)" },
  { kind: "ok",     text: " ✓ tests/e2e/stream.backpressure.spec.ts (8)" },
  { kind: "ok",     text: " ✓ tests/e2e/stream.toolcalls.spec.ts (5)" },
  { kind: "ok",     text: " ✓ tests/e2e/stream.compat.spec.ts (5)" },
  { kind: "plain",  text: "" },
  { kind: "plain",  text: " Test Files  4 passed (4)" },
  { kind: "ok",     text: "      Tests  24 passed (24)" },
  { kind: "dim",    text: "   Duration  3.42s" },
  { kind: "plain",  text: "" },
  { kind: "prompt", text: "aura@workspace:~/api$ git diff --stat" },
  { kind: "plain",  text: " src/api/chat.ts        | 116 +++++++++++++++--------" },
  { kind: "plain",  text: " src/api/_sse.ts        |  41 ++++++++" },
  { kind: "plain",  text: " src/api/embed.ts       |  10 +-" },
  { kind: "plain",  text: " src/edge/worker.ts     |  27 +++--" },
  { kind: "plain",  text: " tests/e2e/stream.spec.ts | 31 ++++++" },
  { kind: "plain",  text: " 5 files changed, 184 insertions(+), 41 deletions(-)" },
  { kind: "plain",  text: "" },
  { kind: "prompt", text: "aura@workspace:~/api$ _", cursor: true },
];

// ====== Test results ======
const TEST_SUITES = [
  { name: "stream.basic.spec.ts",        pass: 6, fail: 0, duration: "412ms", status: "pass" },
  { name: "stream.backpressure.spec.ts", pass: 8, fail: 0, duration: "1.2s",  status: "pass" },
  { name: "stream.toolcalls.spec.ts",    pass: 5, fail: 0, duration: "634ms", status: "pass" },
  { name: "stream.compat.spec.ts",       pass: 5, fail: 0, duration: "1.1s",  status: "pass" },
  { name: "session-manager.spec.ts",     pass: 12, fail: 0, duration: "2.4s", status: "pass",
    detail: "All 12 cases green, including the parallel-refresh race regression (50 iterations, 0 failures)." },
];

// ====== PR data ======
const PR_DATA = {
  "CLD-138": {
    num: 4821,
    title: "fix(auth): serialize token refresh via in-flight promise cache",
    branch: "bolt/session-race → main",
    body: "Closes CLD-7821. Two parallel requests can each trigger a refresh, racing on the cookie write. This serializes refreshes per-user via an in-flight promise map.",
    checks: [
      { name: "ci / unit",        status: "ok",      meta: "passed in 1m 12s" },
      { name: "ci / integration", status: "ok",      meta: "passed in 3m 04s" },
      { name: "ci / e2e",         status: "ok",      meta: "passed in 4m 21s" },
      { name: "lint + typecheck", status: "ok",      meta: "passed in 28s" },
      { name: "bundle-size",      status: "ok",      meta: "−2.1KB" },
      { name: "vercel / preview", status: "ok",      meta: "ready" },
      { name: "security-scan",    status: "pending", meta: "running 2m 14s" },
    ],
    reviews: [
      { who: "marin",   what: "approved", badge: "approve", when: "2m ago" },
      { who: "kai",     what: "commented (3 threads)", badge: "comment", when: "8m ago" },
    ],
  },
};

window.AGENTS = AGENTS;
window.TICKETS = TICKETS;
window.TRANSCRIPTS = TRANSCRIPTS;
window.FILE_TREES = FILE_TREES;
window.ACTIVE_DIFF = ACTIVE_DIFF;
window.TERMINAL_LOG = TERMINAL_LOG;
window.TEST_SUITES = TEST_SUITES;
window.PR_DATA = PR_DATA;
