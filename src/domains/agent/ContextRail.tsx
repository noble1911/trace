import type { CSSProperties, ReactNode } from "react";
import { toast } from "@/app/toast";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import type { Issue } from "@/domains/issues/types";
import { jiraBrowseUrl } from "@/domains/issues/url";
import { PrRailSection } from "@/domains/prs/PrRailSection";
import { WorkspaceSection } from "./WorkspaceSection";

interface ContextRailProps {
  issue: Issue;
  site: string | null;
  /** The workspace's PRs (`usePrWatch`, owned by AgentDetail — the header uses them too). */
  prUrls: string[];
  /** Re-reads the checkout when the agent starts (that's when the worktree appears). */
  running: boolean;
}

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`Copied ${text}`),
    () => toast.error("Couldn't copy to clipboard")
  );
}

interface LinkedRowProps {
  icon: (p: { size?: number; style?: CSSProperties }) => ReactNode;
  keyText: string;
  sub?: string | null;
  url?: string;
}

// One linked reference (the issue, its epic): a key that opens in the tracker,
// an optional sub-label, and a copy button for pasting the key into the chat.
function LinkedRow({ icon: Icon, keyText, sub, url }: LinkedRowProps) {
  return (
    <div className="linked-row">
      <Icon size={13} style={{ color: "var(--fg-3)" }} />
      {url ? (
        <a className="linked-key" href={url} target="_blank" rel="noreferrer">
          {keyText}
        </a>
      ) : (
        <span className="linked-key">{keyText}</span>
      )}
      {sub && <span className="linked-sub">{sub}</span>}
      <button
        type="button"
        className="linked-copy"
        onClick={() => copy(keyText)}
        title={`Copy ${keyText}`}
        aria-label={`Copy ${keyText}`}
      >
        <I.Copy size={12} />
      </button>
    </div>
  );
}

// The ticket detail's right rail, ordered by how often it's looked at: the PRs
// (they change constantly), where the agent is working, then the ticket's own
// facts. Live agent status lives in the header only.
export function ContextRail({ issue, site, prUrls, running }: ContextRailProps) {
  // Providers that carry a web URL on the issue (Pylon's `link`) win; Jira's
  // browse URL is built from the site.
  const issueUrl = issue.browseUrl ?? jiraBrowseUrl(site, issue.key);
  const epicUrl = issue.epicKey ? jiraBrowseUrl(site, issue.epicKey) : undefined;

  return (
    <div className="detail-right">
      <PrRailSection urls={prUrls} />
      <WorkspaceSection workspaceId={issue.key} refreshKey={running} />

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
              icon={I.Branch}
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
