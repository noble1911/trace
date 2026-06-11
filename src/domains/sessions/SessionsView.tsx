import { type DragEvent, useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { agentCli, setAgentCli } from "@/domains/agent/defaults";
import { statusOf, useBoardStore } from "@/domains/board/store";
import type { AgentCli } from "@/ipc/agent";
import { ArchiveBin } from "./ArchiveBin";
import { sessionsDrag } from "./dragState";
import { NewSessionModal } from "./NewSessionModal";
import { SectionGroup } from "./SectionGroup";
import { SessionCard } from "./SessionCard";
import { SessionTabs } from "./SessionTabs";
import { useSessionsStore } from "./store";
import { TitleEditor } from "./TitleEditor";
import type { ScratchSession, SessionSection } from "./types";

/** Remove `dragId` and re-insert it before `targetId`. */
function moveBefore<T extends { id: string }>(list: T[], dragId: string, targetId: string): T[] {
  const dragged = list.find((x) => x.id === dragId);
  if (!dragged) return list;
  const without = list.filter((x) => x.id !== dragId);
  const at = without.findIndex((x) => x.id === targetId);
  if (at < 0) return list;
  return [...without.slice(0, at), dragged, ...without.slice(at)];
}

export function SessionsView() {
  const sessions = useSessionsStore((s) => s.sessions);
  const groups = useSessionsStore((s) => s.groups);
  const loaded = useSessionsStore((s) => s.loaded);
  const load = useSessionsStore((s) => s.load);
  const create = useSessionsStore((s) => s.create);
  const rename = useSessionsStore((s) => s.rename);
  const select = useSessionsStore((s) => s.select);
  const archive = useSessionsStore((s) => s.archive);
  const unarchive = useSessionsStore((s) => s.unarchive);
  const remove = useSessionsStore((s) => s.remove);
  const saveGroups = useSessionsStore((s) => s.saveGroups);
  const assign = useSessionsStore((s) => s.assign);
  const running = useBoardStore((s) => s.runningAgents);
  const agentActivity = useBoardStore((s) => s.agentActivity);
  const [creating, setCreating] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const active = sessions.filter((s) => !s.archivedAt);
  const archived = sessions.filter((s) => s.archivedAt);

  // Normalize dangling refs (deleted tab/section) back to the default bucket.
  const tabIds = new Set(groups.tabs.map((t) => t.id));
  const tabOf = (s: ScratchSession) => (s.tab && tabIds.has(s.tab) ? s.tab : null);
  const inTab = active.filter((s) => tabOf(s) === activeTab);
  const sections = groups.sections.filter((sec) => (sec.tab ?? null) === activeTab);
  const sectionIds = new Set(sections.map((s) => s.id));
  const sectionOf = (s: ScratchSession) =>
    s.section && sectionIds.has(s.section) ? s.section : null;
  const unsectioned = inTab.filter((s) => sectionOf(s) === null);

  // --- groups manipulation (frontend owns the structure; backend sanitizes) ---
  const addTab = (name: string) => {
    const id = crypto.randomUUID();
    void saveGroups({ ...groups, tabs: [...groups.tabs, { id, name }] }).then(() =>
      setActiveTab(id)
    );
  };
  const renameTab = (id: string, name: string) =>
    void saveGroups({
      ...groups,
      tabs: groups.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
    });
  const deleteTab = (id: string) => {
    setActiveTab(null);
    // Reload sessions afterwards — the backend re-homed the tab's sessions.
    void saveGroups({ ...groups, tabs: groups.tabs.filter((t) => t.id !== id) }).then(load);
  };
  const addSection = (name: string) =>
    void saveGroups({
      ...groups,
      sections: [
        ...groups.sections,
        { id: crypto.randomUUID(), name, tab: activeTab, collapsed: false },
      ],
    });
  const patchSection = (id: string, patch: Partial<SessionSection>) =>
    void saveGroups({
      ...groups,
      sections: groups.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  const deleteSection = (id: string) =>
    void saveGroups({ ...groups, sections: groups.sections.filter((s) => s.id !== id) }).then(load);
  const sectionToEnd = (dragId: string) => {
    const dragged = groups.sections.find((s) => s.id === dragId);
    if (!dragged) return;
    void saveGroups({
      ...groups,
      sections: [...groups.sections.filter((s) => s.id !== dragId), dragged],
    });
  };

  const onCreate = (title: string, cli: AgentCli) => {
    setAgentCli(cli);
    setCreating(false);
    void create(title, cli).then((s) => {
      if (activeTab) void assign(s.id, activeTab, null);
    });
  };

  // The unsectioned grid accepts session drops (unfile from a section) and
  // section drops (move the section to the end of this tab).
  const unsectionedDrop = {
    onDragOver: (e: DragEvent) => {
      if (sessionsDrag.current) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const drag = sessionsDrag.current;
      sessionsDrag.current = null;
      if (!drag) return;
      if (drag.kind === "session") void assign(drag.id, activeTab, null);
      else if (drag.kind === "section") sectionToEnd(drag.id);
    },
  };

  const grid = (list: ScratchSession[]) => (
    <div className="session-grid">
      {list.map((s) => (
        <SessionCard
          key={s.id}
          session={s}
          status={statusOf(running.has(s.id), agentActivity[s.id])}
          onOpen={() => select(s.id)}
          onArchive={() => void archive(s.id)}
          onRename={(title) => void rename(s.id, title)}
        />
      ))}
    </div>
  );

  const nothingAnywhere = active.length === 0 && archived.length === 0 && groups.tabs.length === 0;

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
      <SessionTabs
        tabs={groups.tabs}
        countOf={(tab) => active.filter((s) => tabOf(s) === tab).length}
        active={activeTab}
        onSelect={setActiveTab}
        onAdd={addTab}
        onRename={(id, name) => renameTab(id, name)}
        onDelete={deleteTab}
        onReorder={(dragId, targetId) =>
          void saveGroups({ ...groups, tabs: moveBefore(groups.tabs, dragId, targetId) })
        }
        onDropSession={(sessionId, tab) => void assign(sessionId, tab, null)}
      />
      <div className="page-body">
        {nothingAnywhere ? (
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
            <div className="unsectioned" {...unsectionedDrop}>
              {unsectioned.length > 0 ? (
                grid(unsectioned)
              ) : (
                <div className="pr-muted">No unfiled sessions — drop cards here to unfile.</div>
              )}
            </div>

            {sections.map((sec) => (
              <SectionGroup
                key={sec.id}
                section={sec}
                count={inTab.filter((s) => sectionOf(s) === sec.id).length}
                onToggle={() => patchSection(sec.id, { collapsed: !sec.collapsed })}
                onRename={(name) => patchSection(sec.id, { name })}
                onDelete={() => deleteSection(sec.id)}
                onDropSession={(id) => void assign(id, activeTab, sec.id)}
                onDropSection={(dragId) =>
                  void saveGroups({
                    ...groups,
                    sections: moveBefore(groups.sections, dragId, sec.id),
                  })
                }
              >
                {grid(inTab.filter((s) => sectionOf(s) === sec.id))}
              </SectionGroup>
            ))}

            {addingSection ? (
              <div className="sec-add-edit">
                <TitleEditor
                  initial=""
                  onSave={addSection}
                  onClose={() => setAddingSection(false)}
                />
              </div>
            ) : (
              <button type="button" className="sec-add" onClick={() => setAddingSection(true)}>
                <I.Plus size={12} /> Add section
              </button>
            )}

            {archived.length > 0 && (
              <ArchiveBin
                archived={archived}
                open={binOpen}
                onToggle={() => setBinOpen((v) => !v)}
                onRestore={(id) => void unarchive(id)}
                onDelete={(id) => void remove(id)}
                onDropSession={(id) => void archive(id)}
              />
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
