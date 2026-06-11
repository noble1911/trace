/* global React, I, AgentAvatar, StatusPill, STATUS_META,
   TRANSCRIPTS, FILE_TREES, ACTIVE_DIFF, TERMINAL_LOG, TEST_SUITES, PR_DATA, agentLookup */

const TABS = [
  { id: "chat", label: "Chat", icon: I.Chat },
  { id: "files", label: "Files", icon: I.Code },
  { id: "terminal", label: "Terminal", icon: I.Terminal },
  { id: "tests", label: "Tests", icon: I.Beaker },
  { id: "pr", label: "Pull request", icon: I.GitPR },
  { id: "ticket", label: "Ticket", icon: I.Ticket },
];

function AgentDetail({ ticket, onBack, onMove, onAdvance }) {
  const [tab, setTab] = React.useState(ticket.status === "review" ? "pr" : "chat");
  const a = agentLookup(ticket.agent);

  // Synced when ticket switches
  React.useEffect(() => { setTab(ticket.status === "review" ? "pr" : "chat"); }, [ticket.id]);

  return (
    <div className="detail">
      <div className="detail-top">
        <button className="back" onClick={onBack}>
          <I.Back size={14}/> Board
        </button>
        <AgentAvatar id={ticket.agent} size="lg"/>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="id">{ticket.id}</span>
            <span style={{ color: "var(--fg-4)" }}>·</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-2)" }}>
              {a.id}
            </span>
            <StatusPill status={ticket.status}/>
          </div>
          <div className="ttl">{ticket.title}</div>
        </div>
        <div className="right">
          {ticket.state === "thinking" && <span className="thinking">working</span>}
          {ticket.state === "waiting"  && <span className="waiting">waiting for you</span>}
          <NextAction ticket={ticket} onAdvance={onAdvance}/>
          <button className="btn ghost" title="More"><I.Dot3 size={16}/></button>
        </div>
      </div>

      <div className="detail-body">
        <div className="detail-left">
          <div className="detail-tabs">
            {TABS.map(t => {
              const Ico = t.icon;
              const count = tabCount(t.id, ticket);
              return (
                <button
                  key={t.id}
                  className={"detail-tab" + (tab === t.id ? " active" : "")}
                  onClick={() => setTab(t.id)}
                >
                  <Ico size={13}/>
                  {t.label}
                  {count !== null && <span className="count">{count}</span>}
                </button>
              );
            })}
          </div>

          {tab === "chat"     && <ChatPane ticket={ticket}/>}
          {tab === "files"    && <FilesPane ticket={ticket}/>}
          {tab === "terminal" && <TerminalPane ticket={ticket}/>}
          {tab === "tests"    && <TestsPane ticket={ticket}/>}
          {tab === "pr"       && <PRPane ticket={ticket} onAdvance={onAdvance}/>}
          {tab === "ticket"   && <TicketPane ticket={ticket}/>}
        </div>

        <ContextRail ticket={ticket}/>
      </div>
    </div>
  );
}

function tabCount(tabId, ticket) {
  if (tabId === "files" && ticket.filesChanged) return ticket.filesChanged;
  if (tabId === "tests") return "24";
  if (tabId === "pr" && ticket.pr) return "#" + ticket.pr.num;
  return null;
}

function NextAction({ ticket, onAdvance }) {
  if (ticket.status === "todo") {
    return <button className="btn primary" onClick={() => onAdvance(ticket.id, "in_progress")}>
      <I.Bolt size={13}/> Start agent
    </button>;
  }
  if (ticket.status === "in_progress") {
    return <button className="btn primary" onClick={() => onAdvance(ticket.id, "review")}>
      <I.GitPR size={13}/> Raise PR
    </button>;
  }
  if (ticket.status === "review") {
    return <button className="btn success" onClick={() => onAdvance(ticket.id, "done")}>
      <I.Check size={13}/> Approve & merge
    </button>;
  }
  return <span className="btn ghost" style={{ cursor: "default" }}>
    <I.Check size={13}/> Shipped
  </span>;
}

/* ============ Chat ============ */
function ChatPane({ ticket }) {
  const transcript = TRANSCRIPTS[ticket.id] || [
    { who: "system", name: "system", time: "—", body: [{ p: "No transcript yet. Send the first message below to start the agent." }] }
  ];
  const a = agentLookup(ticket.agent);
  const [draft, setDraft] = React.useState("");
  const scrollerRef = React.useRef();
  React.useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [ticket.id]);

  return (
    <div className="agent-chat">
      <div className="stream" ref={scrollerRef}>
        {transcript.map((m, i) => (
          <AgentMsg key={i} m={m} agent={a}/>
        ))}
        {ticket.state === "thinking" && (
          <AgentMsg m={{ who: "agent", name: a.id, time: "now",
            body: [{ p: <span className="thinking">thinking</span> }] }} agent={a}/>
        )}
      </div>
      <div className="composer">
        <div className="row">
          <textarea
            placeholder={`Reply to ${a.id} — they can read the workspace, run commands, and push commits.`}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={1}
          />
          <button className="send" disabled={!draft.trim()} onClick={() => setDraft("")} title="Send">
            <I.Send size={13}/>
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, fontSize: 11, color: "var(--fg-4)" }}>
          <span className="kbd">⌘↵</span> send
          <span className="kbd">@</span> mention another agent
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
            haiku 4.5 · 12.4k / 200k tokens
          </span>
        </div>
      </div>
    </div>
  );
}

function AgentMsg({ m, agent }) {
  const isAgent = m.who === "agent";
  const isSystem = m.who === "system";
  const isHuman = m.who === "human";

  return (
    <div className="amsg">
      <div>
        {isAgent && <AgentAvatar id={agent.id} size="lg"/>}
        {isHuman && (
          <span className="agent-avatar lg" style={{ background: "linear-gradient(135deg, #555, #222)", color: "var(--fg-1)" }}>
            Y
          </span>
        )}
        {isSystem && (
          <span className="agent-avatar lg" style={{ background: "var(--bg-3)", border: "1px solid var(--border)", color: "var(--fg-3)" }}>
            ⌥
          </span>
        )}
      </div>
      <div className="body">
        <div className="head">
          <span className="name" style={{ color: isSystem ? "var(--fg-3)" : "var(--fg-0)" }}>{m.name}</span>
          <span className="time">{m.time}</span>
        </div>
        {m.body.map((blk, i) => {
          if (blk.p) return <p key={i} style={isSystem ? { color: "var(--fg-3)" } : {}}>{blk.p}</p>;
          if (blk.code) return <pre key={i} className="code">{blk.code}</pre>;
          if (blk.tool) return (
            <div key={i} className="toolcall">
              <span style={{ color: "var(--c-accent)" }}>⚡</span>
              <span>{blk.tool}</span>
              <span style={{ color: "var(--fg-3)" }}>{blk.target}</span>
              {blk.result && <span className="ok">✓ {blk.result}</span>}
            </div>
          );
          return null;
        })}
      </div>
    </div>
  );
}

/* ============ Files / Diff ============ */
function FilesPane({ ticket }) {
  const tree = FILE_TREES[ticket.id];
  if (!tree) {
    return (
      <div className="tab-pane">
        <EmptyTab icon={<I.Code size={28}/>} title="No files touched yet" hint="The agent will populate this once it starts editing." />
      </div>
    );
  }
  const [active, setActive] = React.useState(tree.find(n => n.active)?.path || tree.find(n => n.path)?.path);

  return (
    <div className="tab-pane no-pad">
      <div className="files-pane">
        <div className="file-tree">
          {tree.map((n, i) => {
            if (n.group) return <div key={i} className="group">{n.group}</div>;
            const isActive = active === n.path;
            return (
              <div key={i} className={"node" + (isActive ? " active" : "")} onClick={() => setActive(n.path)}>
                <I.File size={12}/>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {n.path.split("/").pop()}
                </span>
                <span className="stat">
                  {n.kind === "new"
                    ? <span className="new">new</span>
                    : <><span className="add">+{n.add}</span> <span className="del">−{n.del}</span></>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="diff-pane">
          <div className="diff-head">
            <span className="path">{ACTIVE_DIFF.path}</span>
            <span className="stat">
              <span style={{ color: "var(--c-done)" }}>+{ACTIVE_DIFF.add}</span>{" "}
              <span style={{ color: "var(--c-danger)" }}>−{ACTIVE_DIFF.del}</span>
            </span>
          </div>
          {ACTIVE_DIFF.hunks.map((h, i) => (
            <div key={i}>
              <div className="diff-hunk">{h.header}</div>
              {h.lines.map((l, j) => (
                <div key={j} className={"diff-line " + l.kind}>
                  <div className="ln">{l.a ?? ""}</div>
                  <div className="ln">{l.b ?? ""}</div>
                  <div className="content">{l.text}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============ Terminal ============ */
function TerminalPane({ ticket }) {
  return (
    <div className="tab-pane no-pad" style={{ background: "var(--bg-0)" }}>
      <div className="terminal">
        {TERMINAL_LOG.map((l, i) => {
          if (l.kind === "prompt") return (
            <div key={i}>
              <span className="prompt">$</span>{" "}
              <span>{l.text.replace(/^.*\$\s*/, "")}</span>
              {l.cursor && <span className="cursor"/>}
            </div>
          );
          return <div key={i} className={l.kind}>{l.text}</div>;
        })}
      </div>
    </div>
  );
}

/* ============ Tests ============ */
function TestsPane({ ticket }) {
  const totalPass = TEST_SUITES.reduce((a, s) => a + s.pass, 0);
  const totalFail = TEST_SUITES.reduce((a, s) => a + s.fail, 0);
  const [expanded, setExpanded] = React.useState(TEST_SUITES.findIndex(s => s.detail));
  return (
    <div className="tab-pane">
      <div className="tests-summary">
        <span className="item"><b style={{ color: "var(--c-done)" }}>{totalPass}</b> passed</span>
        <span className="item"><b style={{ color: totalFail ? "var(--c-danger)" : "var(--fg-3)" }}>{totalFail}</b> failed</span>
        <span className="item">Last run <b>3 min ago</b> · 5.8s</span>
        <span className="item" style={{ marginLeft: "auto" }}>
          <button className="btn ghost" style={{ height: 24 }}>
            <I.Bolt size={12}/> Re-run
          </button>
        </span>
      </div>
      <div className="tests">
        {TEST_SUITES.map((s, i) => (
          <div key={i} className={"test-suite " + s.status} onClick={() => setExpanded(expanded === i ? -1 : i)} style={{ cursor: "pointer" }}>
            <div className="row">
              <span style={{ color: s.status === "pass" ? "var(--c-done)" : "var(--c-danger)" }}>
                {s.status === "pass" ? <I.Check size={13}/> : <I.X size={13}/>}
              </span>
              <span className="name">{s.name}</span>
              <span className="stat">
                <span className="ok">{s.pass} ✓</span>{s.fail > 0 ? <> · <span className="fail">{s.fail} ✗</span></> : null}
              </span>
              <span className="duration">{s.duration}</span>
            </div>
            {expanded === i && s.detail && (
              <div className="test-detail">{s.detail}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ PR ============ */
function PRPane({ ticket, onAdvance }) {
  const pr = PR_DATA[ticket.id];
  if (!pr) {
    return (
      <div className="tab-pane">
        <EmptyTab
          icon={<I.GitPR size={28}/>}
          title={ticket.pr ? "PR data loading…" : "No PR yet"}
          hint={ticket.status === "in_progress"
            ? "The agent will open one when the work is ready for review."
            : "Move this ticket forward to raise one."}
          action={ticket.status === "in_progress" ? {
            label: "Raise PR now",
            onClick: () => onAdvance(ticket.id, "review"),
          } : null}
        />
      </div>
    );
  }
  return (
    <div className="tab-pane">
      <div className="pr-card">
        <div className="head">
          <span className="num">#{pr.num}</span>
          <span className="ttl">{pr.title}</span>
          <span style={{ marginLeft: "auto" }} className="pr-pill open">open</span>
        </div>
        <div className="body">
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--fg-2)" }}>
            <I.Branch size={13}/>
            <span style={{ fontFamily: "var(--font-mono)" }}>{pr.branch}</span>
          </div>
          <div style={{ fontSize: 13.5, color: "var(--fg-1)", lineHeight: 1.55 }}>{pr.body}</div>

          <div>
            <div className="ctx-section" style={{ padding: 0, marginBottom: 8, borderBottom: 0 }}>
              <div className="label">Checks</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pr.checks.map((c, i) => (
                <div key={i} className={"check " + c.status}>
                  <span className="ic">
                    {c.status === "ok" && <I.Check size={14}/>}
                    {c.status === "fail" && <I.X size={14}/>}
                    {c.status === "pending" && <I.Clock size={14}/>}
                  </span>
                  <span className="name">{c.name}</span>
                  <span className="meta">{c.meta}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="ctx-section" style={{ padding: 0, marginBottom: 4, borderBottom: 0 }}>
              <div className="label">Reviews</div>
            </div>
            {pr.reviews.map((r, i) => (
              <div key={i} className="review-line">
                <span className="agent-avatar" style={{ background: "linear-gradient(135deg, #444, #222)", color: "var(--fg-1)" }}>
                  {r.who[0].toUpperCase()}
                </span>
                <span className="who">{r.who}</span>
                <span className="what">{r.what}</span>
                <span className={"badge " + r.badge}>{r.badge}</span>
                <span className="when">{r.when}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
            <button className="btn success" onClick={() => onAdvance(ticket.id, "done")}>
              <I.Check size={13}/> Approve & merge
            </button>
            <button className="btn">Request changes</button>
            <button className="btn ghost" style={{ marginLeft: "auto" }}>View on GitHub →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ Ticket ============ */
function TicketPane({ ticket }) {
  return (
    <div className="tab-pane">
      <div className="ticket-section">
        <h2>{ticket.title}</h2>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {(ticket.labels || []).map(l => <span key={l} className="tag">{l}</span>)}
        </div>
        <div className="ticket-desc">
          {(ticket.description || []).map((p, i) => <p key={i}>{p}</p>)}
        </div>
        {ticket.criteria && (
          <>
            <div className="label" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--fg-3)", marginTop: 16, marginBottom: 8 }}>
              Acceptance criteria
            </div>
            <div className="criteria">
              {ticket.criteria.map((c, i) => (
                <div key={i} className={"criterion" + (c.done ? " done" : "")}>
                  <span className="box">{c.done && <I.Check size={10} stroke={2.5}/>}</span>
                  <span className="txt">{c.text}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="ticket-grid">
          <div><div className="k">Epic</div><div className="v">{ticket.epic || "—"}</div></div>
          <div><div className="k">Reporter</div><div className="v">{ticket.reporter || "—"}</div></div>
          <div><div className="k">Estimate</div><div className="v">{ticket.estimate || "—"}</div></div>
          <div><div className="k">Priority</div><div className="v">{ticket.priority?.toUpperCase()}</div></div>
        </div>
      </div>
    </div>
  );
}

function EmptyTab({ icon, title, hint, action }) {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: 320 }}>
      <div style={{ textAlign: "center", color: "var(--fg-3)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, maxWidth: 320 }}>
        <span style={{ color: "var(--fg-4)" }}>{icon}</span>
        <div style={{ color: "var(--fg-1)", fontSize: 14, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{hint}</div>
        {action && <button className="btn primary" style={{ marginTop: 6 }} onClick={action.onClick}>{action.label}</button>}
      </div>
    </div>
  );
}

/* ============ Context rail (right) ============ */
function ContextRail({ ticket }) {
  const a = agentLookup(ticket.agent);
  return (
    <div className="detail-right">
      <div className="ctx-section">
        <div className="label">Agent</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <AgentAvatar id={ticket.agent} size="xl"/>
          <div>
            <h3 style={{ marginBottom: 2 }}>agent-{a.id}</h3>
            <div style={{ color: "var(--fg-3)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
              haiku 4.5 · spawned 3h ago
            </div>
          </div>
        </div>
        <div className="ctx-row"><span className="k">Status</span><span className="v plain">
          {ticket.state === "thinking" ? <span className="thinking">working</span>
            : ticket.state === "waiting" ? <span className="waiting">awaiting input</span>
            : "idle"}
        </span></div>
        <div className="ctx-row"><span className="k">Branch</span><span className="v">{ticket.branch}</span></div>
        <div className="ctx-row"><span className="k">Tokens</span><span className="v">12.4k / 200k</span></div>
        <div className="ctx-row"><span className="k">Tool calls</span><span className="v">47</span></div>
      </div>

      <div className="ctx-section">
        <div className="label">Workspace</div>
        <div className="ctx-row"><span className="k">Repo</span><span className="v">obsidian/claude-orch</span></div>
        <div className="ctx-row"><span className="k">Base</span><span className="v">main @ a7f3e21</span></div>
        <div className="ctx-row"><span className="k">Container</span><span className="v">node-22-alpine</span></div>
      </div>

      <div className="ctx-section">
        <div className="label">Linked</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          <a className="ctx-row" style={{ textDecoration: "none", color: "var(--fg-1)" }}>
            <I.Ticket size={13} style={{ color: "var(--fg-3)" }}/>
            <span style={{ fontFamily: "var(--font-mono)" }}>{ticket.id}</span>
            <span style={{ color: "var(--fg-3)", marginLeft: 4 }}>Jira</span>
          </a>
          {ticket.pr && (
            <a className="ctx-row" style={{ textDecoration: "none", color: "var(--fg-1)" }}>
              <I.GitPR size={13} style={{ color: "var(--fg-3)" }}/>
              <span style={{ fontFamily: "var(--font-mono)" }}>#{ticket.pr.num}</span>
              <span style={{ color: "var(--fg-3)", marginLeft: 4 }}>GitHub</span>
            </a>
          )}
        </div>
      </div>

      <div className="ctx-section" style={{ flex: 1 }}>
        <div className="label">Activity</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6, fontSize: 12 }}>
          <ActivityItem when="3m"  what="ran `pnpm test stream` → 24 passed"/>
          <ActivityItem when="8m"  what="committed `src/api/_sse.ts (+41)`"/>
          <ActivityItem when="14m" what="read 6 files in `src/api/`"/>
          <ActivityItem when="22m" what="opened branch `aura/stream-tokens`"/>
          <ActivityItem when="1h"  what={<>spawned by <span style={{ color: "var(--fg-1)" }}>you</span></>}/>
        </div>
      </div>
    </div>
  );
}

function ActivityItem({ when, what }) {
  return (
    <div style={{ display: "flex", gap: 10, color: "var(--fg-2)" }}>
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-4)", minWidth: 32 }}>{when}</span>
      <span>{what}</span>
    </div>
  );
}

Object.assign(window, { AgentDetail });
