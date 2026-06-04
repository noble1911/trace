import { type MouseEvent, useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import type { AgentCli } from "@/ipc/agent";
import { NewSessionModal } from "./NewSessionModal";
import { useSessionsStore } from "./store";
import type { ScratchSession } from "./types";

const CLI_KEY = "trace.agentCli";

function storedCli(): AgentCli {
  try {
    return localStorage.getItem(CLI_KEY) === "codex" ? "codex" : "claude";
  } catch {
    return "claude";
  }
}

function relTime(epochSecs: number): string {
  const diff = Date.now() / 1000 - epochSecs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function SessionsView() {
  const sessions = useSessionsStore((s) => s.sessions);
  const loaded = useSessionsStore((s) => s.loaded);
  const load = useSessionsStore((s) => s.load);
  const create = useSessionsStore((s) => s.create);
  const select = useSessionsStore((s) => s.select);
  const remove = useSessionsStore((s) => s.remove);
  const running = useBoardStore((s) => s.runningAgents);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const onCreate = (title: string, cli: AgentCli) => {
    try {
      localStorage.setItem(CLI_KEY, cli);
    } catch {
      // non-fatal — keep the in-memory choice
    }
    setCreating(false);
    void create(title, cli); // create() selects it, opening the detail overlay
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <div className="desc">Exploratory agents not tied to a Jira ticket.</div>
        </div>
        <div className="right">
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            <I.Plus size={14} /> New session
          </button>
        </div>
      </div>
      <div className="page-body">
        {sessions.length === 0 ? (
          <div className="empty-state">
            <div className="inner">
              <span className="ic">
                <I.Sparkles size={28} />
              </span>
              <div className="title">No exploratory sessions yet</div>
              <div className="hint">
                Spin up an interactive agent for spikes, debugging, or poking around — it runs in
                your repo, with no Jira ticket attached.
              </div>
              <button
                type="button"
                className="btn primary"
                style={{ marginTop: 6 }}
                onClick={() => setCreating(true)}
              >
                <I.Plus size={13} /> New session
              </button>
            </div>
          </div>
        ) : (
          <div className="session-grid">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                running={running.has(s.id)}
                onOpen={() => select(s.id)}
                onDelete={() => void remove(s.id)}
              />
            ))}
          </div>
        )}
      </div>
      {creating && (
        <NewSessionModal
          defaultCli={storedCli()}
          onClose={() => setCreating(false)}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}

interface SessionCardProps {
  session: ScratchSession;
  running: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

function SessionCard({ session, running, onOpen, onDelete }: SessionCardProps) {
  const del = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: hosts a nested delete button; HTML forbids nested interactives
    <div
      className="session-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
    >
      <div className="session-card-head">
        <span className={`session-cli ${session.cli}`}>{session.cli}</span>
        {running && <span className="session-live">live</span>}
        <button type="button" className="session-del" onClick={del} aria-label="Delete session">
          <I.X size={13} />
        </button>
      </div>
      <div className="session-title">{session.title}</div>
      <div className="session-meta">{relTime(session.createdAt)}</div>
    </div>
  );
}
