/* global React, I, AGENTS */

const STATUS_META = {
  todo:        { label: "Todo",        color: "var(--c-todo)",   bg: "var(--c-todo-bg)" },
  in_progress: { label: "In progress", color: "var(--c-prog)",   bg: "var(--c-prog-bg)" },
  review:      { label: "In review",   color: "var(--c-review)", bg: "var(--c-review-bg)" },
  done:        { label: "Done",        color: "var(--c-done)",   bg: "var(--c-done-bg)" },
};
const COLUMN_ORDER = ["todo", "in_progress", "review", "done"];

const agentLookup = (id) => AGENTS.find(a => a.id === id) || AGENTS[0];

function AgentAvatar({ id, size = "md" }) {
  const a = agentLookup(id);
  const cls = size === "lg" ? "agent-avatar lg" : size === "xl" ? "agent-avatar xl" : "agent-avatar";
  return (
    <span className={cls} style={{ background: a.color }} title={a.id}>
      {a.initial}
    </span>
  );
}

function StatusPill({ status }) {
  const m = STATUS_META[status];
  return (
    <span className="status-pill" style={{ color: m.color, background: m.bg, borderColor: m.color + "55" }}>
      <span className="d" style={{ background: m.color }}/>
      {m.label}
    </span>
  );
}

function Card({ ticket, onOpen, onDragStart, density }) {
  const isWaiting = ticket.state === "waiting";
  const isThinking = ticket.state === "thinking";
  const inProgress = ticket.status === "in_progress";

  return (
    <button
      className={"card" + (inProgress ? " glow" : "") + (isThinking ? "" : "")}
      draggable
      onDragStart={(e) => onDragStart(e, ticket.id)}
      onClick={() => onOpen(ticket.id)}
    >
      <div className="row">
        <span className={"priority " + ticket.priority}/>
        <span className="ticket-id">{ticket.id}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {isThinking && <span className="thinking">thinking</span>}
          {isWaiting && <span className="waiting">needs you</span>}
          <AgentAvatar id={ticket.agent}/>
        </span>
      </div>

      <div className="title">{ticket.title}</div>

      {ticket.preview && (
        <div className="preview">
          <span className="arrow">↳</span>
          <span className="txt">
            <span className="ag">{ticket.agent}: </span>
            {ticket.preview}
          </span>
        </div>
      )}

      <div className="meta">
        {ticket.branch && ticket.branch !== "—" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <I.Branch size={11}/> {ticket.branch.split("/").pop()}
          </span>
        )}
        {ticket.filesChanged > 0 && (
          <>
            <span className="dot-sep">·</span>
            <span className="diff">
              <span className="add">+{ticket.diff.add}</span>
              <span className="del">−{ticket.diff.del}</span>
              <span style={{ color: "var(--fg-3)" }}>{ticket.filesChanged}f</span>
            </span>
          </>
        )}
        {ticket.pr && (
          <>
            <span className="dot-sep">·</span>
            <span className={"pr-pill " + ticket.pr.status}>#{ticket.pr.num} {ticket.pr.status}</span>
          </>
        )}
      </div>

      {inProgress && ticket.progress > 0 && (
        <div className="progress extras"><span style={{ width: `${Math.round(ticket.progress*100)}%` }}/></div>
      )}
    </button>
  );
}

function Column({ status, tickets, onOpen, onDragStart, onDrop, onSpawn }) {
  const m = STATUS_META[status];
  const [over, setOver] = React.useState(false);
  return (
    <div className="column">
      <div className="col-head">
        <span className="col-dot" style={{ background: m.color, boxShadow: `0 0 8px ${m.color}` }}/>
        <span className="col-name">{m.label}</span>
        <span className="col-count">{tickets.length}</span>
        <button className="col-add" onClick={() => onSpawn(status)} title="Spawn agent in this column">
          <I.Plus size={14}/>
        </button>
      </div>
      <div
        className={"cards" + (over ? " drop-target" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(e, status); }}
      >
        {tickets.length === 0 && (
          <div className="col-empty">
            {status === "todo" ? "Drop a task or spawn an agent" :
             status === "in_progress" ? "Nothing active" :
             status === "review" ? "Waiting on PRs" :
             "Nothing shipped yet"}
          </div>
        )}
        {tickets.map(t => (
          <Card key={t.id} ticket={t} onOpen={onOpen} onDragStart={onDragStart}/>
        ))}
      </div>
    </div>
  );
}

function Board({ tickets, onOpen, onMove, onSpawn, filter, setFilter }) {
  const draggingRef = React.useRef(null);
  const onDragStart = (e, id) => {
    draggingRef.current = id;
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", id); } catch (_) {}
  };
  const onDrop = (_e, status) => {
    if (!draggingRef.current) return;
    onMove(draggingRef.current, status);
    draggingRef.current = null;
  };

  const filtered = filter === "all"
    ? tickets
    : filter === "mine"
      ? tickets.filter(t => t.agent === "aura" || t.agent === "bolt")
      : filter === "active"
        ? tickets.filter(t => t.status === "in_progress" || t.status === "review")
        : tickets.filter(t => t.state === "waiting");

  const byStatus = Object.fromEntries(COLUMN_ORDER.map(s => [s, []]));
  filtered.forEach(t => byStatus[t.status].push(t));

  const waitingCount = tickets.filter(t => t.state === "waiting").length;
  const activeCount = tickets.filter(t => t.status === "in_progress").length;

  return (
    <div className="board">
      <div className="board-header">
        <div>
          <h1>Sprint 47 · Realtime + reliability</h1>
          <div className="subtitle">
            {activeCount} agent{activeCount === 1 ? "" : "s"} active
            {waitingCount > 0 && <> · <span style={{ color: "var(--c-prog)" }}>{waitingCount} waiting for you</span></>}
          </div>
        </div>
        <div className="right">
          <FilterChip active={filter === "all"}      onClick={() => setFilter("all")}>All</FilterChip>
          <FilterChip active={filter === "active"}   onClick={() => setFilter("active")}>Active</FilterChip>
          <FilterChip active={filter === "waiting"}  onClick={() => setFilter("waiting")}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--c-prog)" }}/>
            Needs you
          </FilterChip>
          <FilterChip active={filter === "mine"}     onClick={() => setFilter("mine")}>My agents</FilterChip>
        </div>
      </div>

      <div className="columns">
        {COLUMN_ORDER.map(s => (
          <Column
            key={s} status={s}
            tickets={byStatus[s]}
            onOpen={onOpen}
            onDragStart={onDragStart}
            onDrop={onDrop}
            onSpawn={onSpawn}
          />
        ))}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button className={"filter-chip" + (active ? " active" : "")} onClick={onClick}>
      {children}
    </button>
  );
}

Object.assign(window, { Board, Card, StatusPill, AgentAvatar, STATUS_META, COLUMN_ORDER, agentLookup });
