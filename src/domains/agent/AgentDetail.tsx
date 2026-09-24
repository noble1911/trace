import { openUrl } from "@tauri-apps/plugin-opener";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icon";
import { activity } from "@/domains/activity/store";
import { statusOf, useBoardStore } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/issues/types";
import { canonicalPrUrl } from "@/domains/prs/commentBody";
import { discoverPrs, usePrWatch } from "@/domains/prs/hooks/usePrWatch";
import { PrRailSection } from "@/domains/prs/PrRailSection";
import { primaryPr } from "@/domains/prs/primaryPr";
import { usePrWatchStore } from "@/domains/prs/watchStore";
import { usePersistedFlag } from "@/hooks/usePersistedFlag";
import {
  type AgentCli,
  type AgentProvider,
  agentRunning,
  resetAgentSession,
  stopAgent,
} from "@/ipc/agent";
import { mergePr, raisePr } from "@/ipc/pr";
import { issueRepo, listRepos, setIssueRepo } from "@/ipc/repos";
import { ContextRail } from "./ContextRail";
import { DetailHeader } from "./DetailHeader";
import { agentCli, agentProvider, setAgentCli, setAgentProvider } from "./defaults";
import { FilesPane } from "./FilesPane";
import { launchIssueAgent } from "./launch";
import { PtyTerminal } from "./PtyTerminal";
import { agentLabel } from "./providerLabel";
import { RichOutputPanel } from "./RichOutputPanel";
import { useRichOutputStore } from "./richOutputStore";
import { StartPrompt } from "./StartPrompt";
import { TerminalPane } from "./TerminalPane";
import { TestsPane } from "./TestsPane";
import { TicketPane } from "./TicketPane";

type TabId = "chat" | "html" | "ticket" | "files" | "terminal" | "tests" | "pr";

const TABS: { id: TabId; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { id: "chat", label: "Chat", icon: I.Chat },
  { id: "html", label: "HTML", icon: I.Sparkles },
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

export function AgentDetail({ issue, site, onBack }: AgentDetailProps) {
  const [tab, setTab] = useState<TabId>("chat");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"raise" | "merge" | null>(null);
  const [cli, setCli] = useState<AgentCli>(agentCli);
  const [provider, setProvider] = useState<AgentProvider>(agentProvider);
  const [railOpen, toggleRail] = usePersistedFlag("trace.railOpen", true);
  const [repos, setRepos] = useState<string[]>([]);
  const [repoChoice, setRepoChoice] = useState("");
  const running = useBoardStore((s) => s.runningAgents.has(issue.key));
  // Selecting a primitive (length) keeps this referentially stable across renders.
  const htmlCount = useRichOutputStore((s) => s.blocks[issue.key]?.length ?? 0);
  const status = useBoardStore((s) =>
    statusOf(s.runningAgents.has(issue.key), s.agentActivity[issue.key])
  );
  const setAgentRunning = useBoardStore((s) => s.setAgentRunning);
  const clearOutput = useBoardStore((s) => s.clearOutput);
  const ackWaiting = useBoardStore((s) => s.ackWaiting);
  const startingRef = useRef(false);
  const prs = useBoardStore((s) => s.pullRequests[issue.key] ?? EMPTY_PRS);
  const refreshIssuePrs = useBoardStore((s) => s.refreshIssuePrs);

  // Jira's dev-status PRs, plus whatever the agent raised that Jira hasn't
  // linked (or can't — no dev integration): the branch's PRs and conversation.
  const devUrls = useMemo(
    () => prs.map((pr) => canonicalPrUrl(pr.url)).filter((u): u is string => u !== null),
    [prs]
  );
  const prUrls = usePrWatch(issue.key, [issue.key], devUrls);
  const threads = usePrWatchStore((s) => s.threads);
  const openPr = primaryPr(prUrls, threads, prs);

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

  // Reconcile run-state with the backend on mount. A renderer reload clears the
  // store's `runningAgents`, but the backend PTY survives — without this a live
  // agent shows the Start overlay, and clicking Start no-ops on the backend
  // (already running) after the terminal was cleared, leaving a blank screen.
  // Adopt the backend's truth so the live screen (terminal snapshot) shows.
  useEffect(() => {
    let cancelled = false;
    void agentRunning(issue.key).then((alive) => {
      if (cancelled) return;
      if (alive && !useBoardStore.getState().runningAgents.has(issue.key)) {
        setAgentRunning(issue.key, true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [issue.key, setAgentRunning]);

  // Re-check this issue's PRs on open — they change outside the app.
  useEffect(() => {
    void refreshIssuePrs(issue.key, issue.id);
  }, [issue.key, issue.id, refreshIssuePrs]);

  const chooseCli = (next: AgentCli) => {
    setCli(next);
    setAgentCli(next);
  };
  const chooseProvider = (next: AgentProvider) => {
    setProvider(next);
    setAgentProvider(next);
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
      // SIGWINCH double-painting the banner. No kickoff brief here: starting
      // from inside the ticket opens a plain session (the user is present to
      // direct it) — only the board paths (card button, drag) send the brief.
      await launchIssueAgent(issue.key, { cli, provider });
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

  const onRaisePr = async () => {
    setError(null);
    setBusy("raise");
    try {
      const title = `[${issue.key}] ${issue.summary}`;
      const body = `Closes ${issue.key}${issue.description ? `\n\n${issue.description}` : ""}`;
      const { url } = await raisePr(issue.key, title, body);
      await Promise.all([refreshIssuePrs(issue.key, issue.id), discoverPrs(issue.key)]);
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
        site={site}
        status={status}
        running={running}
        cli={cli}
        provider={provider}
        openPr={openPr}
        busy={busy}
        railOpen={railOpen}
        onBack={onBack}
        onRaisePr={onRaisePr}
        onMergePr={onMergePr}
        onStart={start}
        onStop={stop}
        onChooseCli={chooseCli}
        onChooseProvider={chooseProvider}
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
                  {t.id === "html" && htmlCount > 0 && <span className="count">{htmlCount}</span>}
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
                  agentName={agentLabel(cli, provider)}
                  cliName={cli}
                />
              )}
            </div>
          )}
          {tab === "html" && <RichOutputPanel issueKey={issue.key} />}
          {tab === "ticket" && <TicketPane issue={issue} />}
          {tab === "files" && <FilesPane workspaceId={issue.key} />}
          {tab === "terminal" && <TerminalPane issueKey={issue.key} />}
          {tab === "tests" && <TestsPane issue={issue} />}
          {tab === "pr" && (
            <div className="tab-pane pr-tab">
              {prUrls.length > 0 ? (
                <PrRailSection urls={prUrls} />
              ) : (
                <div className="pr-muted">
                  No pull request yet — raise one from the header, or it appears here as soon as the
                  agent opens one.
                </div>
              )}
            </div>
          )}
        </div>

        {railOpen && <ContextRail issue={issue} site={site} prUrls={prUrls} running={running} />}
      </div>
    </div>
  );
}
