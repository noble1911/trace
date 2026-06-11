import { type MouseEvent, useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { agentCli, setAgentCli } from "@/domains/agent/defaults";
import { useBoardStore } from "@/domains/board/store";
import type { AgentCli } from "@/ipc/agent";
import { NewSessionModal } from "./NewSessionModal";
import { useSessionsStore } from "./store";
import { TitleEditor } from "./TitleEditor";
import type { ScratchSession } from "./types";

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
  const rename = useSessionsStore((s) => s.rename);
  const select = useSessionsStore((s) => s.select);
  const archive = useSessionsStore((s) => s.archive);
  const unarchive = useSessionsStore((s) => s.unarchive);
  const remove = useSessionsStore((s) => s.remove);
  const running = useBoardStore((s) => s.runningAgents);
  const [creating, setCreating] = useState(false);
  const [binOpen, setBinOpen] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const active = sessions.filter((s) => !s.archivedAt);
  const archived = sessions.filter((s) => s.archivedAt);

  const onCreate = (title: string, cli: AgentCli) => {
    setAgentCli(cli);
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
        {active.length === 0 && archived.length === 0 ? (
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
          <>
            {active.length > 0 ? (
              <div className="session-grid">
                {active.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    running={running.has(s.id)}
                    onOpen={() => select(s.id)}
                    onArchive={() => void archive(s.id)}
                    onRename={(title) => void rename(s.id, title)}
                  />
                ))}
              </div>
            ) : (
              <div className="pr-muted">
                No active sessions — create one or restore from the bin.
              </div>
            )}

            {archived.length > 0 && (
              <div className="archive-bin">
                <button
                  type="button"
                  className="archive-head"
                  onClick={() => setBinOpen((v) => !v)}
                >
                  <I.Chevron size={13} style={{ transform: binOpen ? "rotate(90deg)" : "none" }} />
                  <I.Archive size={13} />
                  Archived
                  <span className="count">{archived.length}</span>
                </button>
                {binOpen && (
                  <div className="archive-list">
                    {archived.map((s) => (
                      <ArchivedRow
                        key={s.id}
                        session={s}
                        onRestore={() => void unarchive(s.id)}
                        onDelete={() => void remove(s.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {creating && (
        <NewSessionModal
          defaultCli={agentCli()}
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
  onArchive: () => void;
  onRename: (title: string) => void;
}

function SessionCard({ session, running, onOpen, onArchive, onRename }: SessionCardProps) {
  const [renaming, setRenaming] = useState(false);
  const archive = (e: MouseEvent) => {
    e.stopPropagation();
    onArchive();
  };
  const startRename = (e: MouseEvent) => {
    e.stopPropagation();
    setRenaming(true);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: hosts a nested archive button; HTML forbids nested interactives
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
        <button
          type="button"
          className="session-del"
          onClick={startRename}
          aria-label="Rename session"
          title="Rename"
        >
          <I.Pencil size={13} />
        </button>
        <button
          type="button"
          className="session-del"
          onClick={archive}
          aria-label="Archive session"
          title="Archive"
        >
          <I.Archive size={13} />
        </button>
      </div>
      {renaming ? (
        <TitleEditor initial={session.title} onSave={onRename} onClose={() => setRenaming(false)} />
      ) : (
        <div className="session-title">{session.title}</div>
      )}
      <div className="session-meta">{relTime(session.createdAt)}</div>
    </div>
  );
}

interface ArchivedRowProps {
  session: ScratchSession;
  onRestore: () => void;
  onDelete: () => void;
}

function ArchivedRow({ session, onRestore, onDelete }: ArchivedRowProps) {
  return (
    <div className="archive-row">
      <span className={`session-cli ${session.cli}`}>{session.cli}</span>
      <span className="archive-title">{session.title}</span>
      <span className="archive-when">archived {relTime(session.archivedAt ?? 0)}</span>
      <button type="button" className="archive-action" onClick={onRestore} title="Restore">
        <I.Back size={13} /> Restore
      </button>
      <button
        type="button"
        className="archive-action danger"
        onClick={onDelete}
        title="Delete permanently"
      >
        <I.X size={13} />
      </button>
    </div>
  );
}
