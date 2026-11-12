import type { ReactNode } from "react";
import { toast } from "@/app/toast";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import type { Issue } from "@/domains/issues/types";
import { issueBrowseUrl, jiraBrowseUrl } from "@/domains/issues/url";
import { StartedSessionsSection } from "@/domains/sessions/StartedSessions";
import { copyPlain } from "@/ipc/clipboard";
import { TurnSection } from "./TurnSection";
import { WorkspaceSection } from "./WorkspaceSection";

interface ContextRailProps {
  issue: Issue;
  site: string | null;
  /** Whether the workspace has a PR (it shows in the Pull request tab; this only steers the next step). */
  hasPr: boolean;
  /** Re-reads the checkout when the agent starts (that's when the worktree appears). */
  running: boolean;
}

function copy(text: string) {
  void copyPlain(text).then(
    () => toast.success(`Copied ${text}`),
    () => toast.error("Couldn't copy to clipboard")
  );
}

interface LinkedRowProps {
  icon: (p: { size?: number }) => ReactNode;
  keyText: string;
  sub?: string | null;
  url?: string;
}

// One linked reference (the issue, its epic): a key that opens in the tracker,
// an optional sub-label, and a copy button for pasting the key into the chat
// (revealed on the row's hover or focus, trace-ui §5).
function LinkedRow({ icon: Icon, keyText, sub, url }: LinkedRowProps) {
  return (
    <div className="linked-row">
      <span className="linked-icon">
        <Icon size={14} />
      </span>
      {url ? (
        <a className="linked-key" href={url} target="_blank" rel="noreferrer">
          {keyText}
        </a>
      ) : (
        <span className="linked-key">{keyText}</span>
      )}
      {sub && <span className="linked-sub">{sub}</span>}
      <IconButton
        size="xs"
        className="ghost linked-copy"
        label={`Copy ${keyText}`}
        onClick={() => copy(keyText)}
      >
        <I.Copy size={12} />
      </IconButton>
    </div>
  );
}

// The ticket detail's right rail: what the agent last said and what to do next,
// where it's working, then the ticket's own facts. Its PRs have their own tab.
export function ContextRail({ issue, site, hasPr, running }: ContextRailProps) {
  // Providers that carry a web URL on the issue (Pylon's `link`) win; Jira's
  // browse URL is built from the site.
  const issueUrl = issueBrowseUrl(issue, site);
  const epicUrl = issue.epicKey ? jiraBrowseUrl(site, issue.epicKey) : undefined;

  return (
    <div className="detail-right">
      <TurnSection workspaceId={issue.key} hasPr={hasPr} />
      <WorkspaceSection workspaceId={issue.key} refreshKey={running} />
      <StartedSessionsSection workspaceId={issue.key} />

      <div className="ctx-section">
        <div className="label">Ticket</div>
        <div className="ticket-assignee">
          <AgentAvatar assignee={issue.assignee} size="lg" />
          <div>
            <div className="name">{issue.assignee?.displayName ?? "Unassigned"}</div>
            <div className="sub">{issue.issueType}</div>
          </div>
        </div>
        <div className="linked-list">
          <LinkedRow icon={I.Ticket} keyText={issue.key} sub={issue.statusName} url={issueUrl} />
          {issue.epicKey && (
            <LinkedRow
              icon={I.Layers}
              keyText={issue.epicKey}
              sub={issue.epic ?? "Epic"}
              url={epicUrl}
            />
          )}
        </div>
      </div>
    </div>
  );
}
