import { openUrl } from "@tauri-apps/plugin-opener";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { I } from "@/components/Icon";
import { activity } from "@/domains/activity/store";
import { statusOf, useBoardStore } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/jira/types";
import { type AgentCli, resetAgentSession, stopAgent } from "@/ipc/agent";
import { mergePr, raisePr } from "@/ipc/pr";
import { issueRepo, listRepos, setIssueRepo } from "@/ipc/repos";
import { ContextRail } from "./ContextRail";
import { DetailHeader } from "./DetailHeader";
import { agentCli, setAgentCli } from "./defaults";
import { FilesPane } from "./FilesPane";
import { launchIssueAgent } from "./launch";
import { PrPane } from "./PrPane";
import { PtyTerminal } from "./PtyTerminal";
import { StartPrompt } from "./StartPrompt";
import { TerminalPane } from "./TerminalPane";
import { TestsPane } from "./TestsPane";
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

// Stable reference so the board-store selector below doesn't return a brand-new
// empty array on every render (which would churn re-renders).
const EMPTY_PRS: PullRequest[] = [];

const RAIL_STORAGE_KEY = "trace.railOpen";

function loadRailOpen(): boolean {
  try {
    return localStorage.getItem(RAIL_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function AgentDetail({ issue, site, onBack }: AgentDetailProps) {
  const [tab, setTab] = useState<TabId>("chat");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"raise" | "merge" | null>(null);
  const [cli, setCli] = useState<AgentCli>(agentCli);
  const [railOpen, setRailOpen] = useState(loadRailOpen);
  const [repos, setRepos] = useState<string[]>([]);
  const [repoChoice, setRepoChoice] = useState("");
  const running = useBoardStore((s) => s.runningAgents.has(issue.key));
  const status = useBoardStore((s) =>
    statusOf(s.runningAgents.has(issue.key), s.agentActivity[issue.key])
  );
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);
  const clearOutput = useBoardStore((s) => s.clearOutput);
  const ackWaiting = useBoardStore((s) => s.ackWaiting);
  const startingRef = useRef(false);
  const prs = useBoardStore((s) => s.pullRequests[issue.key] ?? EMPTY_PRS);
  const refreshIssuePrs = useBoardStore((s) => s.refreshIssuePrs);

  const openPr = prs.find((p) => p.state !== "merged" && p.state !== "declined") ?? prs[0] ?? null;

  // Load the configured repos and this issue's saved assignment, defaulting the
  // picker to the assignment (or the first repo).
  useEffect(() => {
    let cancelled = false;
    void Promise.all([listRepos(), issueRepo(issue.key)]).then(([all, assigned]) => {
      if (cancelled) return;
      setRepos(all);
      setRepoChoice(assigned ?? all[0] ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [issue.key]);

  // Viewing a waiting session acknowledges it: the rail/Dock badges clear
  // without requiring a reply. Re-runs when the status flips while open.
  useEffect(() => {
    if (status === "waiting") ackWaiting(issue.key);
  }, [status, issue.key, ackWaiting]);

  const chooseCli = (next: AgentCli) => {
    setCli(next);
    setAgentCli(next);
  };

  const start = async () => {
    // Guard against a re-entrant start: worktree creation takes a few seconds,
    // during which the button still reads "Start". A second click would spawn a
    // *second* agent into the same workspace — two processes painting one
    // terminal, which duplicates the banner.
    if (startingRef.current || running) return;
    if (!repoChoice) {
      setError("Add a repository in Settings, then pick one for this ticket.");
      return;
    }
    startingRef.current = true;
    setError(null);
    try {
      // Remember which repo this ticket runs in — the backend resolves it for
      // every subsequent terminal/files/tests/PR command on this issue.
      await setIssueRepo(issue.key, repoChoice);
      // The terminal is already mounted (behind the StartPrompt overlay) and
      // fitted, so launch spawns the PTY at its exact size — no spawn-time
      // SIGWINCH double-painting the banner.
      await launchIssueAgent(issue.key, cli);
    } catch (err) {
      setError(String(err));
    } finally {
      startingRef.current = false;
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
  // Forget the saved Claude conversation, then start clean — the escape hatch
  // when a stored session id has gone stale ("session not found" on resume).
  const startFresh = async () => {
    await resetAgentSession(issue.key).catch(() => {});
    await start();
  };
  const toggleRail = () => {
    setRailOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem(RAIL_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // persistence is best-effort
      }
      return next;
    });
  };

  const onRaisePr = async () => {
    setError(null);
    setBusy("raise");
    try {
      const title = `[${issue.key}] ${issue.summary}`;
      const body = `Closes ${issue.key}${issue.description ? `\n\n${issue.description}` : ""}`;
      const { url } = await raisePr(issue.key, title, body);
      await refreshIssuePrs(issue.key, issue.id);
      activity.log({ kind: "pr-raised", issueKey: issue.key, title: "raised a PR" });
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
      await mergePr(issue.key, openPr.url);
      await refreshIssuePrs(issue.key, issue.id);
      activity.log({ kind: "pr-merged", issueKey: issue.key, title: `merged #${openPr.number}` });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="detail">
      <DetailHeader
        issue={issue}
        status={status}
        running={running}
        cli={cli}
        openPr={openPr}
        busy={busy}
        railOpen={railOpen}
        onBack={onBack}
        onRaisePr={onRaisePr}
        onMergePr={onMergePr}
        onStart={start}
        onStop={stop}
        onChooseCli={chooseCli}
        onToggleRail={toggleRail}
      />

      {error && (
        <div style={{ padding: "8px 20px", color: "var(--c-danger)", fontSize: 12.5 }}>{error}</div>
      )}

      <div className={`detail-body${railOpen ? "" : " no-rail"}`}>
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
              {!running && (
                <StartPrompt
                  onStart={start}
                  onStartFresh={startFresh}
                  repos={repos}
                  repoChoice={repoChoice}
                  onRepoChange={setRepoChoice}
                />
              )}
            </div>
          )}
          {tab === "ticket" && <TicketPane issue={issue} />}
          {tab === "files" && <FilesPane workspaceId={issue.key} />}
          {tab === "terminal" && <TerminalPane issueKey={issue.key} />}
          {tab === "tests" && <TestsPane issue={issue} />}
          {tab === "pr" && <PrPane issue={issue} />}
        </div>

        {railOpen && <ContextRail issue={issue} status={status} site={site} repo={repoChoice} />}
      </div>
    </div>
  );
}
