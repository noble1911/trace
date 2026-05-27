import { type ReactNode, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { StatusPill } from "@/components/StatusPill";
import { useBoardStore } from "@/domains/board/store";
import type { Issue } from "@/domains/jira/types";
import { startAgent, stopAgent } from "@/ipc/agent";
import { ContextRail } from "./ContextRail";
import { PtyTerminal } from "./PtyTerminal";
import { TicketPane } from "./TicketPane";

type TabId = "chat" | "ticket" | "files" | "terminal" | "tests" | "pr";

const TABS: { id: TabId; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: "chat", label: "Chat", icon: I.Chat },
  { id: "ticket", label: "Ticket", icon: I.Ticket },
  { id: "files", label: "Files", icon: I.Code },
  { id: "terminal", label: "Terminal", icon: I.Terminal },
  { id: "tests", label: "Tests", icon: I.Beaker },
  { id: "pr", label: "Pull request", icon: I.GitPR },
];

interface AgentDetailProps {
  issue: Issue;
  site: string | null;
  onBack: () => void;
}

export function AgentDetail({ issue, site, onBack }: AgentDetailProps) {
  const [tab, setTab] = useState<TabId>("chat");
  const [error, setError] = useState<string | null>(null);
  const running = useBoardStore((s) => s.runningAgents.has(issue.key));
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);

  const start = async () => {
    setError(null);
    try {
      await startAgent(issue.key, 80, 24);
      setAgentRunning(issue.key, true);
    } catch (err) {
      setError(String(err));
    }
  };
  const stop = async () => {
    await stopAgent(issue.key).catch(() => {});
    setAgentRunning(issue.key, false);
  };

  return (
    <div className="detail">
      <div className="detail-top">
        <button type="button" className="back" onClick={onBack}>
          <I.Back size={14} /> Board
        </button>
        <AgentAvatar assignee={issue.assignee} size="lg" />
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="id">{issue.key}</span>
            <StatusPill name={issue.statusName} category={issue.statusCategory} />
          </div>
          <div className="ttl">{issue.summary}</div>
        </div>
        <div className="right">
          {running && <span className="thinking">working</span>}
          {running ? (
            <button type="button" className="btn" onClick={stop}>
              <I.X size={13} /> Stop session
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={start}>
              <I.Bolt size={13} /> Start session
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 20px", color: "var(--c-danger)", fontSize: 12.5 }}>{error}</div>
      )}

      <div className="detail-body">
        <div className="detail-left">
          <div className="detail-tabs">
            {TABS.map((t) => {
              const Ico = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`detail-tab${tab === t.id ? " active" : ""}`}
                  onClick={() => setTab(t.id)}
                >
                  <Ico size={13} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === "chat" &&
            (running ? <PtyTerminal issueKey={issue.key} /> : <StartPrompt onStart={start} />)}
          {tab === "ticket" && <TicketPane issue={issue} />}
          {tab === "files" && (
            <Placeholder title="No files yet" hint="Available once the agent edits files." />
          )}
          {tab === "terminal" && (
            <Placeholder
              title="Terminal"
              hint="The agent runs in the Chat tab's interactive session."
            />
          )}
          {tab === "tests" && (
            <Placeholder title="Tests" hint="Test/CI integration comes in a later round." />
          )}
          {tab === "pr" && (
            <Placeholder
              title="No PR yet"
              hint="Raising and reviewing PRs comes in a later round."
            />
          )}
        </div>

        <ContextRail issue={issue} running={running} site={site} />
      </div>
    </div>
  );
}

function StartPrompt({ onStart }: { onStart: () => void }) {
  return (
    <div className="empty-state">
      <div className="inner">
        <span className="ic">
          <I.Bolt size={28} />
        </span>
        <div className="title">Start an interactive Claude session</div>
        <div className="hint">
          The agent runs in an isolated git worktree for this issue. You'll get the full Claude TUI
          right here.
        </div>
        <button type="button" className="btn primary" style={{ marginTop: 6 }} onClick={onStart}>
          <I.Bolt size={13} /> Start session
        </button>
      </div>
    </div>
  );
}

function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty-state">
      <div className="inner">
        <div className="title">{title}</div>
        <div className="hint">{hint}</div>
      </div>
    </div>
  );
}
