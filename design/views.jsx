/* global React, I, AgentAvatar, StatusPill, agentLookup,
   AGENTS, TICKETS, PR_DATA */

/* ===================== Agents view ===================== */
function AgentsView({ tickets, onOpen }) {
  const [tab, setTab] = React.useState("all");
  // Roll up stats per agent
  const stats = AGENTS.map(a => {
    const owned = tickets.filter(t => t.agent === a.id);
    const active = owned.find(t => t.status === "in_progress" || t.status === "review");
    const merged = owned.filter(t => t.status === "done").length;
    const tokens = owned.length ? (8 + (a.initial.charCodeAt(0) % 9)) : 0;
    return {
      agent: a,
      owned,
      active,
      merged,
      tokens: tokens.toFixed(1) + "k",
      prs: owned.filter(t => t.pr).length,
    };
  });
  const filtered = tab === "all" ? stats
    : tab === "active" ? stats.filter(s => s.active)
    : stats.filter(s => !s.active);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Agents</h1>
          <div className="desc">All Claude sessions in this workspace — past, present, queued.</div>
        </div>
        <div className="right">
          <button className="btn"><I.Plus size={13}/> Spawn agent</button>
        </div>
      </div>
      <div className="tab-bar">
        <button className={tab==="all"?"active":""} onClick={() => setTab("all")}>
          All<span className="count">{stats.length}</span>
        </button>
        <button className={tab==="active"?"active":""} onClick={() => setTab("active")}>
          Active<span className="count">{stats.filter(s=>s.active).length}</span>
        </button>
        <button className={tab==="idle"?"active":""} onClick={() => setTab("idle")}>
          Idle<span className="count">{stats.filter(s=>!s.active).length}</span>
        </button>
      </div>
      <div className="page-body">
        <div className="agents-grid">
          {filtered.map(s => (
            <button
              key={s.agent.id}
              className="agent-card"
              onClick={() => s.active && onOpen(s.active.id)}
            >
              <div className="head">
                <AgentAvatar id={s.agent.id} size="xl"/>
                <div>
                  <div className="name">agent-{s.agent.id}</div>
                  <div className="codename">haiku 4.5 · {s.owned.length} tasks</div>
                </div>
                <span style={{ marginLeft: "auto" }}>
                  {s.active?.state === "thinking" && <span className="thinking">working</span>}
                  {s.active?.state === "waiting"  && <span className="waiting">needs you</span>}
                  {!s.active && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>idle</span>}
                </span>
              </div>
              <div className={"current" + (!s.active ? " idle" : "")}>
                {s.active ? (
                  <>
                    <span className="ticket-id" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)" }}>
                      {s.active.id}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.active.title}
                    </span>
                  </>
                ) : "No current task — available to spawn"}
              </div>
              <div className="stats">
                <div className="stat">
                  <div className="v">{s.merged}</div>
                  <div className="k">Merged</div>
                </div>
                <div className="stat">
                  <div className="v">{s.prs}</div>
                  <div className="k">PRs</div>
                </div>
                <div className="stat">
                  <div className="v">{s.tokens}</div>
                  <div className="k">Tokens / wk</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===================== PRs view ===================== */
function PRsView({ tickets, onOpen }) {
  const [tab, setTab] = React.useState("open");
  const withPR = tickets.filter(t => t.pr);
  const buckets = {
    open: withPR.filter(t => t.pr.status === "open"),
    draft: withPR.filter(t => t.pr.status === "draft"),
    merged: withPR.filter(t => t.pr.status === "merged"),
  };
  const list = buckets[tab] || [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Pull requests</h1>
          <div className="desc">Every PR raised by an agent in this workspace.</div>
        </div>
      </div>
      <div className="tab-bar">
        <button className={tab==="open"?"active":""} onClick={() => setTab("open")}>
          Open<span className="count">{buckets.open.length}</span>
        </button>
        <button className={tab==="draft"?"active":""} onClick={() => setTab("draft")}>
          Draft<span className="count">{buckets.draft.length}</span>
        </button>
        <button className={tab==="merged"?"active":""} onClick={() => setTab("merged")}>
          Merged<span className="count">{buckets.merged.length}</span>
        </button>
      </div>
      <div className="page-body">
        <div className="pr-list">
          <div className="pr-row-head">
            <span></span>
            <span>PR</span>
            <span>Title</span>
            <span>Branch</span>
            <span>Checks</span>
            <span>Agent</span>
            <span style={{ textAlign: "right" }}>Updated</span>
          </div>
          {list.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--fg-4)", fontSize: 13 }}>
              No PRs in this state.
            </div>
          )}
          {list.map(t => {
            const pr = t.pr;
            const checks = pr.checks || { pass: 0, fail: 0, pending: 0 };
            const when = t.activity?.includes("ago") ? t.activity.split("·").pop().trim() : t.activity;
            return (
              <div key={t.id} className="pr-row" onClick={() => onOpen(t.id)}>
                <span className={"status-dot " + pr.status}>
                  {pr.status === "merged" && <I.Check size={11}/>}
                  {pr.status === "open" && <I.GitPR size={11}/>}
                  {pr.status === "draft" && <I.Clock size={11}/>}
                </span>
                <span className="num">#{pr.num}</span>
                <span className="ttl">
                  <span className="ticket">{t.id}</span>
                  {t.title}
                </span>
                <span className="branch">{t.branch}</span>
                <span className="checks">
                  {checks.pass > 0 && <span style={{ color: "var(--c-done)" }}>{checks.pass} ✓</span>}
                  {checks.fail > 0 && <span style={{ color: "var(--c-danger)" }}>· {checks.fail} ✗</span>}
                  {checks.pending > 0 && <span style={{ color: "var(--c-warn)" }}>· {checks.pending} ⋯</span>}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <AgentAvatar id={t.agent}/>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg-2)" }}>{t.agent}</span>
                </span>
                <span className="when">{when}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ===================== Activity view ===================== */
const ACTIVITY = [
  { day: "Today" },
  { time: "9:42", kind: "test",  agent: "aura",  ticket: "CLD-142", text: "ran the streaming e2e suite", meta: "24 / 24 passed · 3.4s" },
  { time: "9:38", kind: "commit", agent: "aura", ticket: "CLD-142", text: "committed src/api/_sse.ts", meta: "+41 −0" },
  { time: "9:34", kind: "wait",  agent: "flux",  ticket: "CLD-141", text: "is waiting for input", meta: "DLQ retention: 7d or 14d?" },
  { time: "9:21", kind: "pr",    agent: "gale",  ticket: "CLD-139", text: "opened PR #4818", meta: "gale/bundle-split → main" },
  { time: "9:12", kind: "spawn", agent: "flux",  ticket: "CLD-141", text: "was spawned", meta: "by you" },
  { time: "8:58", kind: "merge", agent: "delta", ticket: "CLD-130", text: "merged PR #4801", meta: "+412 −178 · 18 files" },

  { day: "Yesterday" },
  { time: "5:14p", kind: "pr",    agent: "bolt",  ticket: "CLD-138", text: "opened PR #4821", meta: "bolt/session-race → main" },
  { time: "3:02p", kind: "test",  agent: "bolt",  ticket: "CLD-138", text: "ran session-manager regression × 100", meta: "100 / 100 clean" },
  { time: "11:48", kind: "spawn", agent: "aura",  ticket: "CLD-142", text: "was spawned", meta: "by you" },
  { time: "10:30", kind: "merge", agent: "halo",  ticket: "CLD-128", text: "merged PR #4789", meta: "+54 −23 · 2 files" },

  { day: "2 days ago" },
  { time: "4:12p", kind: "merge", agent: "juno",  ticket: "CLD-125", text: "merged PR #4762", meta: "+318 −47 · 9 files" },
  { time: "2:01p", kind: "commit", agent: "delta", ticket: "CLD-130", text: "committed migrations/0017_pg16.sql", meta: "+88 −0" },
  { time: "9:55",  kind: "spawn", agent: "delta",  ticket: "CLD-130", text: "was spawned", meta: "via orchestrator" },
];

const ACT_ICON = {
  test:   <I.Beaker size={12}/>,
  commit: <I.Code size={12}/>,
  wait:   <I.Clock size={12}/>,
  pr:     <I.GitPR size={12}/>,
  spawn:  <I.Sparkles size={12}/>,
  merge:  <I.Check size={12}/>,
};

function ActivityView({ onOpen }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <div className="desc">Every event across all agents — commits, runs, PRs, spawns.</div>
        </div>
        <div className="right">
          <button className="filter-chip active">All</button>
          <button className="filter-chip">Commits</button>
          <button className="filter-chip">PRs</button>
          <button className="filter-chip">Tests</button>
        </div>
      </div>
      <div className="page-body">
        <div className="activity">
          {ACTIVITY.map((row, i) => {
            if (row.day) return <div key={i} className="activity-day">{row.day}</div>;
            const cls = row.kind === "merge" || row.kind === "pr" || row.kind === "spawn"
              ? row.kind : "";
            return (
              <div key={i} className={"act-row " + cls} onClick={() => onOpen(row.ticket)} style={{ cursor: "pointer" }}>
                <span className="time">{row.time}</span>
                <span className="ic">{ACT_ICON[row.kind]}</span>
                <div className="body">
                  <span className="ag">{row.agent}</span>{" "}
                  {row.text}{" "}
                  <span className="ticket">{row.ticket}</span>
                  {row.meta && <div className="meta">{row.meta}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ===================== Settings view ===================== */
function SettingsView() {
  const [model, setModel] = React.useState("haiku-4.5");
  const [base, setBase] = React.useState("main");
  const [autoMerge, setAutoMerge] = React.useState(false);
  const [autoTest, setAutoTest] = React.useState(true);
  const [notifyWaiting, setNotifyWaiting] = React.useState(true);
  const [notifyMerge, setNotifyMerge] = React.useState(false);
  const [parallel, setParallel] = React.useState("4");

  const Switch = ({ on, onChange }) => (
    <button className={"switch" + (on ? " on" : "")} onClick={() => onChange(!on)} aria-label="toggle"/>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="desc">Workspace defaults — agents inherit these unless overridden per task.</div>
        </div>
      </div>
      <div className="page-body">
        <div className="settings-wrap">

          <section className="setting-group">
            <h2>Agent defaults</h2>
            <div className="desc">Applied when a new agent is dispatched.</div>
            <div className="setting-row">
              <div>
                <div className="label">Model</div>
                <div className="hint">Override per-agent in the spawn modal.</div>
              </div>
              <div className="control">
                <select value={model} onChange={e => setModel(e.target.value)}>
                  <option value="opus-4.5">Claude Opus 4.5</option>
                  <option value="sonnet-4.5">Claude Sonnet 4.5</option>
                  <option value="haiku-4.5">Claude Haiku 4.5</option>
                </select>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="label">Default base branch</div>
                <div className="hint">All new branches are cut from this.</div>
              </div>
              <div className="control">
                <select value={base} onChange={e => setBase(e.target.value)}>
                  <option value="main">main</option>
                  <option value="develop">develop</option>
                  <option value="release/v2">release/v2</option>
                </select>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="label">Max parallel agents</div>
                <div className="hint">Hard ceiling on concurrent workspaces. Excess agents queue.</div>
              </div>
              <div className="control">
                <select value={parallel} onChange={e => setParallel(e.target.value)}>
                  <option>2</option><option>4</option><option>8</option><option>16</option>
                </select>
              </div>
            </div>
          </section>

          <section className="setting-group">
            <h2>Automation</h2>
            <div className="desc">Things the orchestrator can do without asking.</div>
            <div className="setting-row">
              <div>
                <div className="label">Run tests after every commit</div>
                <div className="hint">Agents wait for CI before saying they're done.</div>
              </div>
              <div className="control"><Switch on={autoTest} onChange={setAutoTest}/></div>
            </div>
            <div className="setting-row">
              <div>
                <div className="label">Auto-merge when all checks pass</div>
                <div className="hint">Requires at least one human approval.</div>
              </div>
              <div className="control"><Switch on={autoMerge} onChange={setAutoMerge}/></div>
            </div>
          </section>

          <section className="setting-group">
            <h2>Notifications</h2>
            <div className="desc">Where you hear about things outside this app.</div>
            <div className="setting-row">
              <div>
                <div className="label">When an agent needs me</div>
                <div className="hint">Pushed to Slack #claude-orch and via desktop notification.</div>
              </div>
              <div className="control"><Switch on={notifyWaiting} onChange={setNotifyWaiting}/></div>
            </div>
            <div className="setting-row">
              <div>
                <div className="label">When a PR merges</div>
                <div className="hint">Posted to Slack only.</div>
              </div>
              <div className="control"><Switch on={notifyMerge} onChange={setNotifyMerge}/></div>
            </div>
          </section>

          <section className="setting-group">
            <h2>Integrations</h2>
            <div className="desc">Where agents pull tickets and push code.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="integration-card">
                <div className="ig-ic" style={{ background: "linear-gradient(135deg, #24292e, #0a0a0a)" }}>GH</div>
                <div className="ig-body">
                  <div className="ig-name">GitHub</div>
                  <div className="ig-sub">obsidian/claude-orch · push, pull, PRs, reviews</div>
                </div>
                <span className="ig-status connected">connected</span>
              </div>
              <div className="integration-card">
                <div className="ig-ic" style={{ background: "linear-gradient(135deg, oklch(0.55 0.18 250), oklch(0.4 0.18 250))" }}>J</div>
                <div className="ig-body">
                  <div className="ig-name">Jira</div>
                  <div className="ig-sub">obsidian.atlassian.net · CLD project · sync labels + status</div>
                </div>
                <span className="ig-status connected">connected</span>
              </div>
              <div className="integration-card">
                <div className="ig-ic" style={{ background: "linear-gradient(135deg, oklch(0.7 0.18 330), oklch(0.5 0.18 330))" }}>S</div>
                <div className="ig-body">
                  <div className="ig-name">Slack</div>
                  <div className="ig-sub">#claude-orch · post agent updates, accept replies</div>
                </div>
                <span className="ig-status connected">connected</span>
              </div>
              <div className="integration-card">
                <div className="ig-ic" style={{ background: "linear-gradient(135deg, #555, #222)" }}>L</div>
                <div className="ig-body">
                  <div className="ig-name">Linear</div>
                  <div className="ig-sub">Not connected.</div>
                </div>
                <span className="ig-status disconnected">connect</span>
              </div>
            </div>
          </section>

          <section className="setting-group" style={{ marginBottom: 24 }}>
            <h2>Danger zone</h2>
            <div className="desc">These can't be undone.</div>
            <div className="setting-row">
              <div>
                <div className="label">Stop all running agents</div>
                <div className="hint">Sends SIGTERM to every workspace. Uncommitted work is lost.</div>
              </div>
              <div className="control">
                <button className="btn" style={{
                  background: "oklch(0.68 0.18 25 / 0.12)",
                  borderColor: "oklch(0.68 0.18 25 / 0.4)",
                  color: "var(--c-danger)",
                }}>Stop everything</button>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AgentsView, PRsView, ActivityView, SettingsView });
