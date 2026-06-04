import { openUrl } from "@tauri-apps/plugin-opener";
import { type ReactNode, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { StatusPill } from "@/components/StatusPill";
import { useBoardStore } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/jira/types";
import { type AgentCli, startAgent, stopAgent } from "@/ipc/agent";
import { mergePr, raisePr } from "@/ipc/pr";
import { ContextRail } from "./ContextRail";
import { FilesPane } from "./FilesPane";
import { PtyTerminal } from "./PtyTerminal";
import { TicketPane } from "./TicketPane";
import { fitTerminal, resetTerminal } from "./terminalRegistry";

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

const CLI_STORAGE_KEY = "trace.agentCli";

// Stable reference so the board-store selector below doesn't return a brand-new
// empty array on every render (which would churn re-renders).
const EMPTY_PRS: PullRequest[] = [];

function loadStoredCli(): AgentCli {
  try {
    const v = localStorage.getItem(CLI_STORAGE_KEY);
    return v === "codex" ? "codex" : "claude";
  } catch {
    return "claude";
  }
}

export function AgentDetail({ issue, site, onBack }: AgentDetailProps) {
  const [tab, setTab] = useState<TabId>("chat");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"raise" | "merge" | null>(null);
  const [cli, setCli] = useState<AgentCli>(loadStoredCli);
  const running = useBoardStore((s) => s.runningAgents.has(issue.key));
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);
  const clearOutput = useBoardStore((s) => s.clearOutput);
  const prs = useBoardStore((s) => s.pullRequests[issue.key] ?? EMPTY_PRS);
  const refreshIssuePrs = useBoardStore((s) => s.refreshIssuePrs);

  const openPr = prs.find((p) => p.state !== "merged" && p.state !== "declined") ?? prs[0] ?? null;

  const chooseCli = (next: AgentCli) => {
    setCli(next);
    try {
      localStorage.setItem(CLI_STORAGE_KEY, next);
    } catch {
      // localStorage can be unavailable in some sandboxed contexts — keep the
      // in-memory choice and silently skip persistence.
    }
  };

  const start = async () => {
    setError(null);
    // The terminal is already mounted (behind the StartPrompt overlay) and fitted
    // to the real pane, so we spawn the PTY at its exact size — no spawn-time
    // SIGWINCH, which is what used to repaint the banner a second time. Clear any
    // prior session's buffer/screen so a re-run starts clean.
    const size = fitTerminal(issue.key) ?? { cols: 80, rows: 24 };
    clearOutput(issue.key);
    resetTerminal(issue.key);
    try {
      await startAgent(issue.key, size.cols, size.rows, undefined, cli);
      setAgentRunning(issue.key, true);
    } catch (err) {
      setError(String(err));
    }
  };
  const stop = async () => {
    await stopAgent(issue.key).catch(() => {});
    setAgentRunning(issue.key, false);
    clearOutput(issue.key);
    // Keep the terminal alive and attached — it stays measurable so the next
    // start() can spawn at the real pane size, and it's torn down by
    // PtyTerminal's unmount cleanup once nothing is running.
  };

  const onRaisePr = async () => {
    setError(null);
    setBusy("raise");
    try {
      const title = `[${issue.key}] ${issue.summary}`;
      const body = `Closes ${issue.key}${issue.description ? `\n\n${issue.description}` : ""}`;
      const { url } = await raisePr(issue.key, title, body);
      await refreshIssuePrs(issue.key, issue.id);
      void openUrl(url);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const onMergePr = async () => {
    if (!openPr) return;
    setError(null);
    setBusy("merge");
    try {
      await mergePr(openPr.url);
      await refreshIssuePrs(issue.key, issue.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
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
          {openPr && openPr.state !== "merged" ? (
            <button
              type="button"
              className="btn success"
              onClick={onMergePr}
              disabled={busy === "merge"}
            >
              <I.Check size={13} /> {busy === "merge" ? "Merging…" : `Merge #${openPr.number}`}
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={onRaisePr}
              disabled={busy === "raise"}
              title="Push branch and open a pull request via gh"
            >
              <I.GitPR size={13} /> {busy === "raise" ? "Raising…" : "Raise PR"}
            </button>
          )}
          {running ? (
            <button type="button" className="btn" onClick={stop}>
              <I.X size={13} /> Stop session
            </button>
          ) : (
            <>
              <select
                value={cli}
                onChange={(e) => chooseCli(e.target.value as AgentCli)}
                title="Which coding agent to launch"
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
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
              <button type="button" className="btn primary" onClick={start}>
                <I.Bolt size={13} /> Start {cli}
              </button>
            </>
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

          {tab === "chat" && (
            // The terminal mounts even before the session starts so it can be
            // measured/fitted to the real pane; StartPrompt overlays it until then.
            <div className="pty-host-wrap">
              <PtyTerminal issueKey={issue.key} />
              {!running && <StartPrompt onStart={start} />}
            </div>
          )}
          {tab === "ticket" && <TicketPane issue={issue} />}
          {tab === "files" && <FilesPane issue={issue} />}
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
