import { openUrl } from "@tauri-apps/plugin-opener";
import { type KeyboardEvent, type MouseEvent, useState } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/jira/types";

type Tab = "open" | "draft" | "merged";
const TABS: Tab[] = ["open", "draft", "merged"];

interface Row {
  pr: PullRequest;
  issue: Issue;
}

// Unified list of every PR linked to a current-sprint issue, from Jira's dev panel.
export function PrsView() {
  const data = useBoardStore((s) => s.data);
  const pullRequests = useBoardStore((s) => s.pullRequests);
  const openIssue = useBoardStore((s) => s.openIssue);
  const [tab, setTab] = useState<Tab>("open");

  const rows: Row[] = [];
  if (data) {
    for (const issue of data.issues) {
      const prs = pullRequests[issue.key] ?? [];
      for (const pr of prs) rows.push({ pr, issue });
    }
  }

  const buckets: Record<Tab, Row[]> = {
    open: rows.filter((r) => r.pr.state === "open"),
    draft: rows.filter((r) => r.pr.state === "draft"),
    merged: rows.filter((r) => r.pr.state === "merged"),
  };
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
            {t[0].toUpperCase() + t.slice(1)}
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
            <span />
            <span>Assignee</span>
            <span style={{ textAlign: "right" }}>State</span>
          </div>
          {list.length === 0 && (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--fg-4)",
                fontSize: 13,
              }}
            >
              No {tab} PRs.
            </div>
          )}
          {list.map(({ pr, issue }) => (
            <PrRow key={pr.url} pr={pr} issue={issue} onOpenIssue={openIssue} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface PrRowProps {
  pr: PullRequest;
  issue: Issue;
  onOpenIssue: (key: string) => void;
}

function PrRow({ pr, issue, onOpenIssue }: PrRowProps) {
  const open = () => void openUrl(pr.url);
  const ticketClick = (e: MouseEvent) => {
    e.stopPropagation();
    onOpenIssue(issue.key);
  };
  const ticketKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      onOpenIssue(issue.key);
    }
  };
  const rowKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") open();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: hosts a nested role=button for the ticket key; HTML forbids nested interactives
    <div className="pr-row" role="button" tabIndex={0} onClick={open} onKeyDown={rowKey}>
      <span className={`status-dot ${pr.state}`}>
        {pr.state === "merged" && <I.Check size={11} />}
        {pr.state === "open" && <I.GitPR size={11} />}
        {pr.state === "draft" && <I.Clock size={11} />}
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
          style={{ cursor: "pointer" }}
        >
          {issue.key}
        </span>
        {pr.title || issue.summary}
      </span>
      <span className="branch">workspace/{issue.key.toLowerCase()}</span>
      <span />
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <AgentAvatar assignee={issue.assignee} />
        <span style={{ fontSize: 11.5, color: "var(--fg-2)" }}>
          {issue.assignee?.displayName ?? "—"}
        </span>
      </span>
      <span className="when" style={{ textAlign: "right" }}>
        {pr.state}
      </span>
    </div>
  );
}
