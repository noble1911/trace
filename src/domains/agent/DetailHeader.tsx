import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { StatusPill } from "@/components/StatusPill";
import type { SessionStatus } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/jira/types";
import type { AgentCli } from "@/ipc/agent";

interface DetailHeaderProps {
  issue: Issue;
  status: SessionStatus;
  running: boolean;
  cli: AgentCli;
  openPr: PullRequest | null;
  busy: "raise" | "merge" | null;
  railOpen: boolean;
  onBack: () => void;
  onRaisePr: () => void;
  onMergePr: () => void;
  onStart: () => void;
  onStop: () => void;
  onChooseCli: (cli: AgentCli) => void;
  onToggleRail: () => void;
}

// The agent workspace top bar: issue identity, live agent status, and the
// PR / session / rail actions. Purely presentational — all state lives in
// AgentDetail.
export function DetailHeader({
  issue,
  status,
  running,
  cli,
  openPr,
  busy,
  railOpen,
  onBack,
  onRaisePr,
  onMergePr,
  onStart,
  onStop,
  onChooseCli,
  onToggleRail,
}: DetailHeaderProps) {
  return (
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
        {status === "working" && <span className="thinking">working</span>}
        {status === "waiting" && <span className="waiting">waiting</span>}
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
          <button type="button" className="btn" onClick={onStop}>
            <I.X size={13} /> Stop session
          </button>
        ) : (
          <>
            <select
              className="cli-select"
              value={cli}
              onChange={(e) => onChooseCli(e.target.value as AgentCli)}
              title="Which coding agent to launch"
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
            <button type="button" className="btn primary" onClick={onStart}>
              <I.Bolt size={13} /> Start {cli}
            </button>
          </>
        )}
        <button
          type="button"
          className="btn ghost"
          onClick={onToggleRail}
          title={railOpen ? "Hide details" : "Show details"}
          aria-label={railOpen ? "Hide details panel" : "Show details panel"}
        >
          {railOpen ? <I.Chevron size={14} /> : <I.Back size={14} />}
        </button>
      </div>
    </div>
  );
}
