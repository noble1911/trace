import { openUrl } from "@tauri-apps/plugin-opener";
import { type KeyboardEvent, type MouseEvent, type ReactNode, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { dedupePrs } from "@/domains/board/prDedupe";
import { useBoardStore } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/jira/types";

type Tab = "open" | "draft" | "merged" | "closed";
const TABS: Tab[] = ["open", "draft", "merged", "closed"];
const TAB_LABEL: Record<Tab, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

interface Row {
  pr: PullRequest;
  issue: Issue;
}

// Map a raw dev-status state ("open"/"merged"/"declined"/"draft") to a tab.
// `declined` is GitHub's closed-without-merge; unknown states stay under Open so
// nothing silently disappears.
function bucketOf(state: string): Tab {
  switch (state.toLowerCase()) {
    case "merged":
      return "merged";
    case "draft":
      return "draft";
    case "declined":
    case "closed":
      return "closed";
    default:
      return "open";
  }
}

// Unified list of every PR linked to a current-sprint issue, from Jira's dev panel.
export function PrsView() {
  const data = useBoardStore((s) => s.data);
  const pullRequests = useBoardStore((s) => s.pullRequests);
  const openIssue = useBoardStore((s) => s.openIssue);
  const [tab, setTab] = useState<Tab>("open");

  // Bucket every PR once, de-duplicating by url with state finality — the
  // dev-status endpoint reports the same PR under every issue it closes, and
  // a stale per-issue cache ("open") must not shadow a fresh one ("merged").
  const entries: [PullRequest, Issue][] = [];
  if (data) {
    for (const issue of data.issues) {
      for (const pr of pullRequests[issue.key] ?? []) {
        entries.push([pr, issue]);
      }
    }
  }
  const buckets: Record<Tab, Row[]> = { open: [], draft: [], merged: [], closed: [] };
  for (const [pr, issue] of dedupePrs(entries)) {
    buckets[bucketOf(pr.state)].push({ pr, issue });
  }
  const list = buckets[tab];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Pull requests</h1>
          <div className="desc">PRs linked to your current sprint, from Jira's dev panel.</div>
        </div>
      </div>
      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={t === tab ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
            <span className="count">{buckets[t].length}</span>
          </button>
        ))}
      </div>
      <div className="page-body">
        <div className="pr-list">
          <div className="pr-row-head">
            <span />
            <span>PR</span>
            <span>Title</span>
            <span>Branch</span>
            <span>Assignee</span>
            <span className="col-state">State</span>
          </div>
          {list.length === 0 ? (
            <div className="pr-empty">No {TAB_LABEL[tab].toLowerCase()} pull requests.</div>
          ) : (
            list.map(({ pr, issue }) => (
              <PrRow key={pr.url} pr={pr} issue={issue} onOpenIssue={openIssue} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const STATE_ICON: Record<Tab, (p: { size?: number }) => ReactNode> = {
  open: I.GitPR,
  merged: I.Check,
  draft: I.Clock,
  closed: I.X,
};

interface PrRowProps {
  pr: PullRequest;
  issue: Issue;
  onOpenIssue: (key: string) => void;
}

function PrRow({ pr, issue, onOpenIssue }: PrRowProps) {
  const bucket = bucketOf(pr.state);
  const StateIcon = STATE_ICON[bucket];
  const open = () => void openUrl(pr.url);
  const openTicket = () => onOpenIssue(issue.key);
  const ticketClick = (e: MouseEvent) => {
    e.stopPropagation();
    openTicket();
  };
  const ticketKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      openTicket();
    }
  };
  const rowKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") open();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: hosts a nested role=button for the ticket; HTML forbids nested interactives
    <div className="pr-row" role="button" tabIndex={0} onClick={open} onKeyDown={rowKey}>
      <span className={`status-dot ${bucket}`}>
        <StateIcon size={12} />
      </span>
      <span className="num">#{pr.number}</span>
      <span className="ttl">
        {/* biome-ignore lint/a11y/useSemanticElements: nested clickable inside a row button; HTML forbids nested buttons */}
        <span
          className="ticket"
          role="button"
          tabIndex={0}
          onClick={ticketClick}
          onKeyDown={ticketKey}
        >
          {issue.key}
        </span>
        <span className="text">{pr.title || issue.summary}</span>
      </span>
      <span className="branch">workspace/{issue.key.toLowerCase()}</span>
      <span className="who">
        <AgentAvatar assignee={issue.assignee} />
        <span className="name">{issue.assignee?.displayName ?? "—"}</span>
      </span>
      <span className="col-state">
        <span className={`pr-pill ${bucket}`}>{pr.state}</span>
      </span>
    </div>
  );
}
