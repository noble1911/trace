import { type DragEvent, useEffect, useRef, useState } from "react";
import { toast } from "@/app/toast";
import { I, ICON_SIZE } from "@/components/Icon";
import { agentCli, agentProvider, setAgentCli, setAgentProvider } from "@/domains/agent/defaults";
import { noteTransport } from "@/domains/agentChat/transport";
import { ConductorEmptyOffer } from "@/domains/settings/ConductorImportButton";
import { setWorkspaceTransport } from "@/ipc/agentChat";
import { setAgentOption } from "@/ipc/agentOptions";
import { ArchiveBin } from "./ArchiveBin";
import { sessionsDrag } from "./dragState";
import {
  moveBefore,
  patchSectionIn,
  renameTabIn,
  sectionToEnd,
  withNewSection,
  withNewTab,
  withoutSection,
  withoutTab,
} from "./groupOps";
import { useLastTab } from "./hooks/useLastTab";
import { useRemoteSessions } from "./hooks/useRemoteSessions";
import { useSessionColumns } from "./hooks/useSessionColumns";
import { ListSortMenu, useSessionLists } from "./hooks/useSessionLists";
import { launchSession } from "./launch";
import { NewSessionModal, type NewSessionRequest } from "./NewSessionModal";
import { useSessionOrderStore } from "./orderStore";
import { RemoteSessions } from "./RemoteSessions";
import { SectionGroup } from "./SectionGroup";
import { SessionTabs } from "./SessionTabs";
import { useSessionsStore } from "./store";
import { TitleEditor } from "./TitleEditor";
import type { ScratchSession, SessionSection } from "./types";

export function SessionsView() {
  const sessions = useSessionsStore((s) => s.sessions);
  const groups = useSessionsStore((s) => s.groups);
  const loaded = useSessionsStore((s) => s.loaded);
  const load = useSessionsStore((s) => s.load);
  const create = useSessionsStore((s) => s.create);
  const archive = useSessionsStore((s) => s.archive);
  const unarchive = useSessionsStore((s) => s.unarchive);
  const remove = useSessionsStore((s) => s.remove);
  const saveGroups = useSessionsStore((s) => s.saveGroups);
  const assign = useSessionsStore((s) => s.assign);
  const orderLoaded = useSessionOrderStore((s) => s.loaded);
  const loadOrder = useSessionOrderStore((s) => s.load);
  const [creating, setCreating] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  // The tab you were on last time, if you have several.
  const [activeTab, setActiveTab] = useLastTab(groups.tabs.map((t) => t.id));
  const [addingSection, setAddingSection] = useState(false);
  const remote = useRemoteSessions();

  useEffect(() => {
    if (!loaded) {
      load().catch((err) => toast.error(`Couldn't load your sessions: ${String(err)}`));
    }
  }, [loaded, load]);
  useEffect(() => {
    if (!orderLoaded) {
      loadOrder().catch((err) => toast.error(`Couldn't load your session order: ${String(err)}`));
    }
  }, [orderLoaded, loadOrder]);

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
  const { renderList, moveIn } = useSessionLists(inTab, (s) => ({
    tab: tabOf(s),
    section: sectionOf(s),
  }));

  // --- groups manipulation (pure ops in groupOps.ts; backend sanitizes) ---
  const addTab = (name: string) => {
    const { next, id } = withNewTab(groups, name);
    void saveGroups(next).then(() => setActiveTab(id));
  };
  const deleteTab = (id: string) => {
    setActiveTab(null);
    // Reload sessions afterwards — the backend re-homed the tab's sessions.
    void saveGroups(withoutTab(groups, id)).then(load);
  };
  const patchSection = (id: string, patch: Partial<SessionSection>) =>
    void saveGroups(patchSectionIn(groups, id, patch));
  const deleteSection = (id: string) => void saveGroups(withoutSection(groups, id)).then(load);

  const onCreate = (req: NewSessionRequest) => {
    setAgentCli(req.cli);
    setAgentProvider(req.provider);
    setCreating(false);
    create(req.title, req.cli, req.repo, req.provider, req.folder, req.host)
      .then(async (s) => {
        if (activeTab) void assign(s.id, activeTab, null);
        // Its first start runs on what was picked here (and every start after).
        noteTransport(s.id, req.transport);
        await setWorkspaceTransport(s.id, req.transport).catch(() => {});
        // Model and mode are the workspace's own options, saved before it starts.
        if (req.model) await setAgentOption(s.id, "model", req.model).catch(() => {});
        if (req.mode) await setAgentOption(s.id, "permissionMode", req.mode).catch(() => {});
        // A task typed in the dialog starts the agent and is its first message;
        // without one the session waits at its prompt, as it always has. A failed
        // start is its own error: the session itself was created and is on the page.
        if (req.prompt) {
          await launchSession(s, req.prompt).catch((err) =>
            toast.error(`Created the session, but its agent didn't start: ${String(err)}`)
          );
        }
      })
      // A Vercel session without a GitHub remote is refused, with a readable reason.
      .catch((err) => toast.error(`Couldn't create the session: ${String(err)}`));
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
      if (drag.kind === "session") moveIn(drag.id, { tab: activeTab, section: null });
      else if (drag.kind === "section") void saveGroups(sectionToEnd(groups, drag.id));
    },
  };

  const bodyRef = useRef<HTMLDivElement>(null);
  useSessionColumns(bodyRef);

  const nothingAnywhere =
    active.length === 0 &&
    archived.length === 0 &&
    groups.tabs.length === 0 &&
    remote.joinable.length === 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <div className="desc">Exploratory agents not tied to a ticket.</div>
        </div>
        <div className="right">
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            <I.Plus size={14} /> New session…
          </button>
        </div>
      </div>
      <SessionTabs
        tabs={groups.tabs}
        countOf={(tab) => active.filter((s) => tabOf(s) === tab).length}
        active={activeTab}
        onSelect={setActiveTab}
        onAdd={addTab}
        onRename={(id, name) => void saveGroups(renameTabIn(groups, id, name))}
        onDelete={deleteTab}
        onReorder={(dragId, targetId) =>
          void saveGroups({ ...groups, tabs: moveBefore(groups.tabs, dragId, targetId) })
        }
        onDropSession={(sessionId, tab) => moveIn(sessionId, { tab, section: null })}
      />
      <div className="page-body" ref={bodyRef}>
        {nothingAnywhere ? (
          <div className="empty-state">
            <div className="inner">
              <span className="ic">
                <I.Sparkles size={ICON_SIZE.empty} />
              </span>
              <div className="title">No exploratory sessions yet</div>
              <div className="hint">
                Spin up an interactive agent for spikes, debugging, or poking around — in a repo or
                any folder, with no ticket attached.
              </div>
              <button type="button" className="btn empty-action" onClick={() => setCreating(true)}>
                <I.Plus size={14} /> New session…
              </button>
              <ConductorEmptyOffer />
            </div>
          </div>
        ) : (
          <>
            <div className="unsectioned" {...unsectionedDrop}>
              <div className="sl-head">
                <ListSortMenu place={{ tab: activeTab, section: null }} />
              </div>
              {renderList(
                unsectioned,
                { tab: activeTab, section: null },
                <div className="pr-muted">Drop a session here to take it out of its section.</div>
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
                sortMenu={<ListSortMenu place={{ tab: activeTab, section: sec.id }} />}
                onDropSession={(id) => moveIn(id, { tab: activeTab, section: sec.id })}
                onDropSection={(dragId) =>
                  void saveGroups({
                    ...groups,
                    sections: moveBefore(groups.sections, dragId, sec.id),
                  })
                }
              >
                {renderList(
                  inTab.filter((s) => sectionOf(s) === sec.id),
                  { tab: activeTab, section: sec.id }
                )}
              </SectionGroup>
            ))}

            {addingSection ? (
              <div className="sec-add-edit">
                <TitleEditor
                  initial=""
                  onSave={(name) => void saveGroups(withNewSection(groups, name, activeTab))}
                  onClose={() => setAddingSection(false)}
                />
              </div>
            ) : (
              <button type="button" className="sec-add" onClick={() => setAddingSection(true)}>
                <I.Plus size={12} /> Add section
              </button>
            )}

            {remote.connected && <RemoteSessions remote={remote} />}

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
          defaultProvider={agentProvider()}
          onClose={() => setCreating(false)}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}
