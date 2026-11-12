import { openUrl } from "@tauri-apps/plugin-opener";
import { BackButton } from "@/components/BackButton";
import { BusyLabel } from "@/components/BusyLabel";
import { I } from "@/components/Icon";
import type { MenuItem } from "@/components/PopMenu";
import { MoreTrigger, PopMenu } from "@/components/PopMenu";
import { StatusLight } from "@/components/StatusLight";
import { StatusPill } from "@/components/StatusPill";
import type { Issue, PullRequest } from "@/domains/issues/types";
import { issueBrowseUrl } from "@/domains/issues/url";
import type { AgentLight } from "@/domains/live/types";
import { prStateLabel } from "@/domains/prs/prState";
import type { AgentCli, AgentProvider, Transport } from "@/ipc/agent";
import { editorItems } from "./editorItems";
import { agentLabel } from "./providerLabel";
import { RestartChip } from "./RestartChip";
import type { RunsOnState } from "./runsOn";
import { StartSplitButton } from "./StartSplitButton";

interface DetailHeaderProps {
  issue: Issue;
  /** Jira site, for the key's browse link (providers with `browseUrl` don't need it). */
  site: string | null;
  /** The agent's light, and what it's asking for when it needs you. */
  light: AgentLight;
  askLabel?: string;
  /** Working, but not heard from in a while: "No recent update" (`live/quietStore`). */
  quiet: boolean;
  running: boolean;
  /** The agent ended by itself: offer a restart in place of Start. */
  exited: boolean;
  cli: AgentCli;
  /** Model provider behind the Claude harness (third-party Anthropic-compatible endpoint). */
  provider: AgentProvider;
  openPr: PullRequest | null;
  busy: "raise" | "merge" | null;
  onBack: () => void;
  /** The page Back returns to ("Inbox", "Board", …). */
  backLabel: string;
  onRaisePr: () => void;
  onMergePr: () => void;
  onStart: () => void;
  onStop: () => void;
  onChooseCli: (cli: AgentCli) => void;
  onChooseProvider: (provider: AgentProvider) => void;
  /** Chat or terminal for the next start; undefined = Settings' default. */
  transport: Transport | undefined;
  onChooseTransport: (transport: Transport) => void;
  /** Where the agent runs (this machine or a sandbox). */
  runsOn: RunsOnState;
  /** Restart, Open in terminal / as chat (`agentChat/agentMenu`). */
  agentItems: MenuItem[];
  /** The pane layout's own (Reset layout). */
  layoutItems: MenuItem[];
}

const isLive = (state: string) => state === "open" || state === "draft";

interface PrActionProps {
  openPr: PullRequest | null;
  busy: "raise" | "merge" | null;
  onRaisePr: () => void;
  onMergePr: () => void;
  /** In a sandbox: Raise PR and Merge need a local worktree, so only an existing PR shows. */
  remote: boolean;
}

// The header's PR button follows the PR's real state: merge an open one, view a
// finished one, and only offer "Raise PR" when the workspace has none at all. Raise
// PR drops to its icon when the header is narrow (`header-fit.css`); Merge #N and a
// PR's number keep their words. Busy, each says its verb in the same width.
function PrAction({ openPr, busy, onRaisePr, onMergePr, remote }: PrActionProps) {
  if (openPr && isLive(openPr.state) && !remote) {
    return (
      <button
        type="button"
        className="btn success"
        onClick={onMergePr}
        disabled={busy === "merge"}
        aria-busy={busy === "merge"}
      >
        <I.GitMerge size={14} />
        <BusyLabel busy={busy === "merge"} idle={`Merge #${openPr.number}`} working="Merging…" />
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
        <I.GitPR size={14} /> #{openPr.number} {prStateLabel(openPr.state)}
      </button>
    );
  }
  if (remote) return null;
  return (
    <button
      type="button"
      className="btn fit"
      onClick={onRaisePr}
      disabled={busy === "raise"}
      aria-busy={busy === "raise"}
      title="Raise PR: push the branch and open a pull request with gh"
    >
      <I.GitPR size={14} />
      <span className="fit-label">
        <BusyLabel busy={busy === "raise"} idle="Raise PR" working="Raising…" />
      </span>
    </button>
  );
}

// The agent workspace top bar: issue identity, then status → the run control
// (Start / Stop) → the PR action → ⋯. Stop and Raise PR drop to icons when the
// header is narrow. Purely presentational — all state lives in AgentDetail.
export function DetailHeader({
  issue,
  site,
  light,
  askLabel,
  quiet,
  running,
  exited,
  cli,
  provider,
  openPr,
  busy,
  onBack,
  backLabel,
  onRaisePr,
  onMergePr,
  onStart,
  onStop,
  onChooseCli,
  onChooseProvider,
  transport,
  onChooseTransport,
  runsOn,
  agentItems,
  layoutItems,
}: DetailHeaderProps) {
  const issueUrl = issueBrowseUrl(issue, site);
  return (
    <div className="detail-top">
      <BackButton label={backLabel} onBack={onBack} />
      <div>
        <div className="detail-meta">
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
          <span className="sep">·</span>
          <StatusPill name={issue.statusName} category={issue.statusCategory} quiet />
        </div>
        <div className="ttl">{issue.summary}</div>
      </div>
      <div className="right">
        {running && (
          <StatusLight light={light} label={askLabel} quiet={quiet} variant="pill" size="lg" />
        )}
        {running ? (
          <button type="button" className="btn fit" onClick={onStop} title="Stop the agent">
            <I.Stop size={14} />
            <span className="fit-label">Stop</span>
          </button>
        ) : exited ? (
          <RestartChip agentName={agentLabel(cli, provider)} onRestart={onStart} />
        ) : (
          <StartSplitButton
            cli={cli}
            provider={provider}
            onStart={onStart}
            onChoose={(nextCli, nextProvider) => {
              onChooseCli(nextCli);
              onChooseProvider(nextProvider);
            }}
            transport={transport}
            onChooseTransport={onChooseTransport}
            runsOn={runsOn}
          />
        )}
        <PrAction
          openPr={openPr}
          busy={busy}
          onRaisePr={onRaisePr}
          onMergePr={onMergePr}
          remote={runsOn.remote}
        />
        <PopMenu
          trigger={({ open, toggle }) => (
            <MoreTrigger open={open} toggle={toggle} label="More actions" />
          )}
          sections={[
            ...(runsOn.remote ? [] : [{ title: "Worktree", items: editorItems(issue.key) }]),
            { title: "Agent", items: agentItems },
            { title: "Layout", items: layoutItems },
          ]}
        />
      </div>
    </div>
  );
}
