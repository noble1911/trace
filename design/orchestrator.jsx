/* global React, I */

function OrchestratorFab({ onOpen, waitingCount }) {
  return (
    <button className="orch-fab" onClick={onOpen}>
      <span className="glow"><I.Sparkles size={12}/></span>
      <span style={{ fontWeight: 500 }}>Orchestrator</span>
      {waitingCount > 0 && (
        <span style={{
          fontSize: 10.5, padding: "2px 7px", borderRadius: 999,
          background: "var(--c-prog-bg)", color: "var(--c-prog)",
          fontFamily: "var(--font-mono)"
        }}>
          {waitingCount} need you
        </span>
      )}
      <kbd>⌘K</kbd>
    </button>
  );
}

const ORCH_MESSAGES = [
  { who: "system", time: "9:14 AM", body: [
    { p: "Good morning. Here's where Sprint 47 stands:" },
  ]},
  { who: "system", time: "9:14 AM", body: [
    { p: <>
      <b>2 agents active</b> · aura (CLD-142) and flux (CLD-141)<br/>
      <b>2 in review</b> · bolt (CLD-138) is ready to merge, gale (CLD-139) has 1 failing check<br/>
      <span style={{ color: "var(--c-prog)" }}>flux needs you</span> — has a config question blocking CLD-141.
    </> },
  ]},
  { who: "user", time: "9:16 AM", body: [
    { p: "Approve & merge bolt's PR if security-scan clears. Tell flux to use 14d DLQ TTL." },
  ]},
  { who: "system", time: "9:16 AM", body: [
    { p: "On it." },
    { suggest: {
      title: "I'll do two things — confirm?",
      actions: [
        { label: "Approve & merge #4821 when scan ✓", primary: true },
        { label: "Reply to flux: 14d TTL" },
      ]
    }},
  ]},
];

function OrchestratorPanel({ onClose, onJumpTo, tickets }) {
  const [draft, setDraft] = React.useState("");
  const waiting = tickets.filter(t => t.state === "waiting");
  const inProgress = tickets.filter(t => t.status === "in_progress");
  const reviewing = tickets.filter(t => t.status === "review");

  return (
    <div className="orch-panel" role="dialog" aria-label="Orchestrator">
      <div className="head">
        <span className="glow" style={{
          width: 22, height: 22, borderRadius: "50%",
          background: "linear-gradient(135deg, oklch(0.72 0.16 290), oklch(0.78 0.15 70))",
          display: "grid", placeItems: "center", color: "#0a0a0a"
        }}><I.Sparkles size={11}/></span>
        <div>
          <div className="title">Orchestrator</div>
          <div className="sub">overseeing {inProgress.length + reviewing.length} agents</div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">
          <I.X size={14}/>
        </button>
      </div>

      <div className="orch-msgs">
        {ORCH_MESSAGES.map((m, i) => (
          <div key={i} className={"msg " + m.who}>
            <div className="who">{m.who === "user" ? "you" : "orch"}</div>
            <div className="body">
              {m.body.map((blk, j) => {
                if (blk.p) return <p key={j}>{blk.p}</p>;
                if (blk.suggest) return (
                  <div key={j} className="orch-suggest">
                    <div className="title">{blk.suggest.title}</div>
                    <div className="actions">
                      {blk.suggest.actions.map((a, k) =>
                        <button key={k} className={a.primary ? "primary" : ""}>{a.label}</button>
                      )}
                    </div>
                  </div>
                );
                return null;
              })}
            </div>
          </div>
        ))}

        {waiting.length > 0 && (
          <div className="orch-suggest" style={{ borderStyle: "solid", borderColor: "oklch(0.78 0.15 70 / 0.4)" }}>
            <div className="title" style={{ color: "var(--c-prog)" }}>{waiting.length} agent{waiting.length===1?"":"s"} waiting on you</div>
            <div className="actions">
              {waiting.map(t => (
                <button key={t.id} onClick={() => onJumpTo(t.id)}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-3)" }}>{t.id}</span>{" "}
                  {t.agent}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="orch-input-wrap">
        <div className="orch-input">
          <textarea
            placeholder="Ask the orchestrator anything — spawn agents, broadcast, summarize…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={1}
          />
          <button className="send" disabled={!draft.trim()} onClick={() => setDraft("")}>
            <I.Send size={12}/>
          </button>
        </div>
        <div className="orch-quick">
          <button>Spawn new agent</button>
          <button>Summarize sprint</button>
          <button>Find conflicts</button>
          <button>Reorder backlog</button>
        </div>
      </div>
    </div>
  );
}

function SpawnModal({ onClose, onCreate, defaultStatus }) {
  const [title, setTitle] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [base, setBase] = React.useState("main");
  const [priority, setPriority] = React.useState("p2");

  const handleSubmit = () => {
    if (!title.trim()) return;
    onCreate({ title: title.trim(), desc, base, priority, status: defaultStatus || "todo" });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Spawn new agent</h2>
          <div className="desc">A new ticket is created and an agent is dispatched in its own workspace.</div>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Task</label>
            <input
              autoFocus
              placeholder="What should this agent do? e.g. Add rate limiting to /v1/embed"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
            <span className="hint">A ticket id will be generated. Branch will be `agent-name/slug`.</span>
          </div>
          <div className="field">
            <label>Context (optional)</label>
            <textarea
              placeholder="Links, acceptance criteria, anything the agent should know up front…"
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Base branch</label>
              <select value={base} onChange={e => setBase(e.target.value)}>
                <option value="main">main</option>
                <option value="develop">develop</option>
                <option value="release/v2">release/v2</option>
              </select>
            </div>
            <div className="field">
              <label>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="p0">P0 — Critical</option>
                <option value="p1">P1 — High</option>
                <option value="p2">P2 — Medium</option>
                <option value="p3">P3 — Low</option>
              </select>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleSubmit} disabled={!title.trim()}>
            <I.Bolt size={13}/> Dispatch agent
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { OrchestratorFab, OrchestratorPanel, SpawnModal });
