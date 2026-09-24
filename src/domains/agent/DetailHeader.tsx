import { openUrl } from "@tauri-apps/plugin-opener";
import { I } from "@/components/Icon";
import { MoreTrigger, PopMenu } from "@/components/PopMenu";
import { StatusPill } from "@/components/StatusPill";
import type { SessionStatus } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/issues/types";
import { jiraBrowseUrl } from "@/domains/issues/url";
import type { AgentCli, AgentProvider } from "@/ipc/agent";
import { editorItems } from "./editorItems";
import { StartSplitButton } from "./StartSplitButton";

interface DetailHeaderProps {
  issue: Issue;
  /** Jira site, for the key's browse link (providers with `browseUrl` don't need it). */
  site: string | null;
  status: SessionStatus;
  running: boolean;
  cli: AgentCli;
  /** Model provider behind the Claude harness (third-party Anthropic-compatible endpoint). */
  provider: AgentProvider;
  openPr: PullRequest | null;
  busy: "raise" | "merge" | null;
  railOpen: boolean;
  onBack: () => void;
  onRaisePr: () => void;
  onMergePr: () => void;
  onStart: () => void;
  onStop: () => void;
  onChooseCli: (cli: AgentCli) => void;
  onChooseProvider: (provider: AgentProvider) => void;
  onToggleRail: () => void;
}

const isLive = (state: string) => state === "open" || state === "draft";

interface PrActionProps {
  openPr: PullRequest | null;
  busy: "raise" | "merge" | null;
  onRaisePr: () => void;
  onMergePr: () => void;
}

// The header's PR button follows the PR's real state: merge an open one, view a
// finished one, and only offer "Raise PR" when the workspace has none at all.
function PrAction({ openPr, busy, onRaisePr, onMergePr }: PrActionProps) {
  if (openPr && isLive(openPr.state)) {
    return (
      <button type="button" className="btn success" onClick={onMergePr} disabled={busy === "merge"}>
        <I.Check size={13} /> {busy === "merge" ? "Merging…" : `Merge #${openPr.number}`}
      </button>
    );
  }
  if (openPr) {
    return (
      <button
        type="button"
        className="btn"
        onClick={() => void openUrl(openPr.url)}
        title={openPr.title || "Open on GitHub"}
      >
        <I.GitPR size={13} /> #{openPr.number} {openPr.state}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn"
      onClick={onRaisePr}
      disabled={busy === "raise"}
      title="Push branch and open a pull request via gh"
    >
      <I.GitPR size={13} /> {busy === "raise" ? "Raising…" : "Raise PR"}
    </button>
  );
}

// The agent workspace top bar: issue identity, live agent status, and the
// PR / session / rail actions. Purely presentational — all state lives in
// AgentDetail.
export function DetailHeader({
  issue,
  site,
  status,
  running,
  cli,
  provider,
  openPr,
  busy,
  railOpen,
  onBack,
  onRaisePr,
  onMergePr,
  onStart,
  onStop,
  onChooseCli,
  onChooseProvider,
  onToggleRail,
}: DetailHeaderProps) {
  const issueUrl = issue.browseUrl ?? jiraBrowseUrl(site, issue.key);
  return (
    <div className="detail-top">
      <button type="button" className="back" onClick={onBack}>
        <I.Back size={14} /> Board
      </button>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {issueUrl ? (
            <button
              type="button"
              className="id id-link"
              onClick={() => void openUrl(issueUrl)}
              title={`Open ${issue.key} in the browser`}
            >
              {issue.key}
            </button>
          ) : (
            <span className="id">{issue.key}</span>
          )}
          <StatusPill name={issue.statusName} category={issue.statusCategory} />
        </div>
        <div className="ttl">{issue.summary}</div>
      </div>
      <div className="right">
        {status === "working" && <span className="thinking">working</span>}
        {status === "waiting" && <span className="waiting">waiting</span>}
        <PrAction openPr={openPr} busy={busy} onRaisePr={onRaisePr} onMergePr={onMergePr} />
        {running ? (
          <button type="button" className="btn" onClick={onStop}>
            <I.X size={13} /> Stop session
          </button>
        ) : (
          <StartSplitButton
            cli={cli}
            provider={provider}
            onStart={onStart}
            onChoose={(nextCli, nextProvider) => {
              onChooseCli(nextCli);
              onChooseProvider(nextProvider);
            }}
          />
        )}
        <PopMenu
          trigger={({ toggle }) => <MoreTrigger toggle={toggle} label="More actions" />}
          sections={[{ title: "Worktree", items: editorItems(issue.key) }]}
        />
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
