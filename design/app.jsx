/* global React, ReactDOM, I, Board, AgentDetail, OrchestratorFab, OrchestratorPanel, SpawnModal,
   TICKETS, AGENTS, useTweaks, TweaksPanel, TweakSection, TweakRadio */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "standard",
  "accent": "violet-amber"
}/*EDITMODE-END*/;

const ACCENT_PRESETS = {
  "violet-amber": {
    a: "oklch(0.72 0.16 290)",
    b: "oklch(0.78 0.15 70)",
  },
  "green-cyan": {
    a: "oklch(0.74 0.14 155)",
    b: "oklch(0.78 0.13 200)",
  },
  "pink-violet": {
    a: "oklch(0.76 0.15 330)",
    b: "oklch(0.72 0.16 290)",
  },
  "mono": {
    a: "oklch(0.85 0.0 0)",
    b: "oklch(0.55 0.0 0)",
  },
};

function App() {
  const [tickets, setTickets] = React.useState(TICKETS);
  const [openId, setOpenId] = React.useState(null);
  const [orchOpen, setOrchOpen] = React.useState(false);
  const [spawnOpen, setSpawnOpen] = React.useState(false);
  const [spawnStatus, setSpawnStatus] = React.useState("todo");
  const [filter, setFilter] = React.useState("all");
  const [nav, setNav] = React.useState("board");
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply accent
  React.useEffect(() => {
    const a = ACCENT_PRESETS[tweaks.accent] || ACCENT_PRESETS["violet-amber"];
    document.documentElement.style.setProperty("--c-accent", a.a);
    // also tweak the rail logo + orch glow via inline rule
    let s = document.getElementById("__accent-overrides");
    if (!s) { s = document.createElement("style"); s.id = "__accent-overrides"; document.head.appendChild(s); }
    s.textContent = `
      .rail .logo, .orch-fab .glow, .orch-panel .head .glow {
        background: linear-gradient(135deg, ${a.a}, ${a.b}) !important;
        box-shadow: 0 0 24px -4px ${a.a} !important;
      }
      .progress > span { background: linear-gradient(90deg, ${a.a}, ${a.b}) !important; }
    `;
  }, [tweaks.accent]);

  // ⌘K opens orchestrator
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOrchOpen(o => !o);
      }
      if (e.key === "Escape") {
        if (spawnOpen) setSpawnOpen(false);
        else if (openId) setOpenId(null);
        else if (orchOpen) setOrchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, orchOpen, spawnOpen]);

  const onMove = (id, status) => {
    setTickets(ts => ts.map(t => {
      if (t.id !== id) return t;
      const next = { ...t, status };
      // Side effects on advance
      if (status === "in_progress" && t.status === "todo") {
        next.state = "thinking";
        next.activity = "starting up";
        next.branch = `${t.agent}/${t.id.toLowerCase()}-${(t.title || "task").toLowerCase().split(" ").slice(0,2).join("-")}`;
      }
      if (status === "review" && !t.pr) {
        next.state = "idle";
        next.activity = "PR open · just now";
        const num = 4820 + Math.floor(Math.random()*20);
        next.pr = { num, status: "open", reviews: 0, checks: { pass: 4, fail: 0, pending: 2 } };
        next.progress = 1;
      }
      if (status === "done" && t.pr) {
        next.pr = { ...t.pr, status: "merged" };
        next.activity = "merged just now";
        next.state = "idle";
      }
      return next;
    }));
  };

  const onSpawn = (status) => {
    setSpawnStatus(status);
    setSpawnOpen(true);
  };

  const onCreate = (data) => {
    const idNum = 150 + tickets.filter(t => t.id.startsWith("CLD-")).length - 9;
    const avail = AGENTS.filter(a => !tickets.some(t => t.agent === a.id && (t.status === "in_progress" || t.status === "todo")));
    const agent = (avail[0] || AGENTS[0]).id;
    const newTicket = {
      id: `CLD-${idNum}`,
      title: data.title,
      status: data.status,
      priority: data.priority,
      agent,
      branch: data.status === "todo" ? "—" : `${agent}/new-${idNum}`,
      activity: data.status === "todo" ? "queued" : "starting up",
      state: data.status === "in_progress" ? "thinking" : "idle",
      filesChanged: 0,
      diff: { add: 0, del: 0 },
      progress: 0,
      pr: null,
      preview: null,
      labels: ["new"],
      epic: "—", reporter: "you", estimate: "—",
      description: data.desc ? [data.desc] : ["No description."],
      criteria: [],
    };
    setTickets(ts => [newTicket, ...ts]);
    setSpawnOpen(false);
  };

  const openTicket = tickets.find(t => t.id === openId);
  const waitingCount = tickets.filter(t => t.state === "waiting").length;

  return (
    <>
      <div className={"app " + (tweaks.density === "dense" ? "dense" : tweaks.density === "minimal" ? "minimal" : "")}>
        <aside className="rail">
          <div className="logo">CO</div>
          <nav className="nav">
            <button className={"nav-btn" + (nav === "board" ? " active" : "")} onClick={() => setNav("board")} title="Board">
              <I.Board size={16}/>
              {waitingCount > 0 && <span className="badge"/>}
            </button>
            <button className={"nav-btn" + (nav === "agents" ? " active" : "")} onClick={() => setNav("agents")} title="Agents">
              <I.Agents size={16}/>
            </button>
            <button className={"nav-btn" + (nav === "pr" ? " active" : "")} onClick={() => setNav("pr")} title="Pull requests">
              <I.PR size={16}/>
            </button>
            <button className={"nav-btn" + (nav === "activity" ? " active" : "")} onClick={() => setNav("activity")} title="Activity">
              <I.Activity size={16}/>
            </button>
          </nav>
          <button className={"nav-btn" + (nav === "settings" ? " active" : "")} title="Settings" style={{ marginTop: "auto" }} onClick={() => setNav("settings")}>
            <I.Settings size={16}/>
          </button>
          <div className="me" title="you">M</div>
        </aside>

        <header className="topbar">
          <div className="crumbs">
            <span>obsidian</span>
            <span className="sep">/</span>
            <span className="project">claude-orch</span>
            <span className="sep">/</span>
            <span>{({
              board: "sprint 47",
              agents: "agents",
              pr: "pull requests",
              activity: "activity",
              settings: "settings",
            })[nav]}</span>
          </div>
          <div className="search">
            <I.Search size={13}/>
            <input placeholder="Search agents, tickets, files…"/>
            <kbd>⌘ /</kbd>
          </div>
          <div className="actions">
            <button className="btn ghost" title="Filter"><I.Filter size={14}/></button>
            <button className="btn" onClick={() => onSpawn("todo")}>
              <I.Plus size={13}/> New agent
            </button>
          </div>
        </header>

        <main className="main">
          {nav === "board" && (
            <Board
              tickets={tickets}
              onOpen={setOpenId}
              onMove={onMove}
              onSpawn={onSpawn}
              filter={filter}
              setFilter={setFilter}
            />
          )}
          {nav === "agents"   && <AgentsView tickets={tickets} onOpen={setOpenId}/>}
          {nav === "pr"       && <PRsView    tickets={tickets} onOpen={setOpenId}/>}
          {nav === "activity" && <ActivityView onOpen={setOpenId}/>}
          {nav === "settings" && <SettingsView/>}
        </main>
      </div>

      {openTicket && (
        <AgentDetail
          ticket={openTicket}
          onBack={() => setOpenId(null)}
          onMove={onMove}
          onAdvance={onMove}
        />
      )}

      {!orchOpen && <OrchestratorFab onOpen={() => setOrchOpen(true)} waitingCount={waitingCount}/>}
      {orchOpen && (
        <OrchestratorPanel
          onClose={() => setOrchOpen(false)}
          onJumpTo={(id) => { setOpenId(id); setOrchOpen(false); }}
          tickets={tickets}
        />
      )}

      {spawnOpen && (
        <SpawnModal
          onClose={() => setSpawnOpen(false)}
          onCreate={onCreate}
          defaultStatus={spawnStatus}
        />
      )}

      <TweaksPanel>
        <TweakSection label="Card density"/>
        <TweakRadio
          label="Layout"
          value={tweaks.density}
          onChange={v => setTweak("density", v)}
          options={[
            { value: "minimal",  label: "Minimal" },
            { value: "standard", label: "Standard" },
            { value: "dense",    label: "Rich" },
          ]}
        />
        <TweakSection label="Accent gradient"/>
        <TweakRadio
          label="Hue"
          value={tweaks.accent}
          onChange={v => setTweak("accent", v)}
          options={[
            { value: "violet-amber", label: "Violet / Amber" },
            { value: "green-cyan",   label: "Green / Cyan" },
            { value: "pink-violet",  label: "Pink / Violet" },
            { value: "mono",         label: "Monochrome" },
          ]}
        />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
