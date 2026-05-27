import { useEffect, useState } from "react";
import type { NavId } from "@/app/nav";
import { Rail } from "@/app/Rail";
import { Topbar } from "@/app/Topbar";
import { I } from "@/components/Icon";
import { AgentDetail } from "@/domains/agent/AgentDetail";
import { Board } from "@/domains/board/Board";
import { useBoardStore } from "@/domains/board/store";
import { JiraLogin } from "@/domains/jira/components/JiraLogin";
import { useJiraStore } from "@/domains/jira/store";
import { SettingsView } from "@/domains/settings/SettingsView";
import { onAgentRunState } from "@/ipc/events";

// Shell only — boot, the Jira login gate, nav routing, and the detail overlay.
// All feature logic lives in src/domains/*.
export function App() {
  const [nav, setNav] = useState<NavId>("board");

  const initialized = useJiraStore((s) => s.initialized);
  const session = useJiraStore((s) => s.session);
  const boards = useJiraStore((s) => s.boards);
  const selectedBoardId = useJiraStore((s) => s.selectedBoardId);
  const selectBoard = useJiraStore((s) => s.selectBoard);
  const init = useJiraStore((s) => s.init);

  const data = useBoardStore((s) => s.data);
  const loadBoard = useBoardStore((s) => s.loadBoard);
  const refresh = useBoardStore((s) => s.refresh);
  const selectedIssueKey = useBoardStore((s) => s.selectedIssueKey);
  const closeIssue = useBoardStore((s) => s.closeIssue);
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);

  useEffect(() => {
    void init();
  }, [init]);

  // Keep card "working" badges in sync with agent lifecycle.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onAgentRunState((p) => setAgentRunning(p.workspaceId, p.running)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [setAgentRunning]);

  // Load the board whenever the selected board changes.
  useEffect(() => {
    if (session && selectedBoardId != null) void loadBoard(selectedBoardId);
  }, [session, selectedBoardId, loadBoard]);

  if (!initialized) {
    return (
      <div className="empty-state">
        <div className="inner">
          <div className="title">Starting trace…</div>
        </div>
      </div>
    );
  }

  if (!session) return <JiraLogin />;

  const openIssue = selectedIssueKey
    ? (data?.issues.find((i) => i.key === selectedIssueKey) ?? null)
    : null;
  const project = data?.boardName ?? session.site;

  const boardActions = (
    <>
      {boards.length > 1 && (
        <select
          value={selectedBoardId ?? ""}
          onChange={(e) => selectBoard(Number(e.target.value))}
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--fg-1)",
            height: 30,
            padding: "0 8px",
            fontSize: 12.5,
          }}
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="btn ghost"
        title="Refresh board"
        onClick={() => void refresh()}
      >
        <I.Activity size={14} />
      </button>
    </>
  );

  return (
    <>
      <div className="app">
        <Rail nav={nav} onNav={setNav} waitingCount={0} />
        <Topbar nav={nav} project={project} extra={nav === "board" ? boardActions : undefined} />
        <main className="main">
          {nav === "board" && <Board />}
          {nav === "settings" && <SettingsView />}
          {(nav === "sessions" || nav === "pr" || nav === "activity") && (
            <div className="empty-state">
              <div className="inner">
                <div className="title">Coming soon</div>
                <div className="hint">
                  This view is part of a later round. The board is live now.
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {openIssue && <AgentDetail issue={openIssue} site={session.site} onBack={closeIssue} />}
    </>
  );
}
