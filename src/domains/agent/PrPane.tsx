import { type ReactNode, useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/jira/types";
import { type PrDetails, prDetails } from "@/ipc/pr";

const EMPTY_PRS: PullRequest[] = [];

const CHECK_ICON: Record<string, (p: { size?: number }) => ReactNode> = {
  ok: I.Check,
  fail: I.X,
  pending: I.Clock,
};

function relTime(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function stateClass(state: string, isDraft: boolean): string {
  if (isDraft) return "draft";
  switch (state.toUpperCase()) {
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "closed";
    default:
      return "open";
  }
}

const REVIEW_TEXT: Record<string, string> = {
  approved: "approved these changes",
  changes: "requested changes",
  commented: "left a comment",
};

// The "Pull request" tab — the issue's PR with CI checks and reviews, via `gh`.
export function PrPane({ issue }: { issue: Issue }) {
  const prs = useBoardStore((s) => s.pullRequests[issue.key] ?? EMPTY_PRS);
  const pr = prs.find((p) => p.state !== "merged" && p.state !== "declined") ?? prs[0] ?? null;
  const [details, setDetails] = useState<PrDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const url = pr?.url ?? null;
  useEffect(() => {
    if (!url) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    setDetails(null);
    setError(null);
    prDetails(url)
      .then((d) => {
        if (!cancelled) setDetails(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!pr) {
    return (
      <Centered
        title="No pull request yet"
        hint="Use “Raise PR” in the header once this issue's changes are ready to review."
      />
    );
  }
  if (error) return <Centered title="Couldn't load the PR" hint={error} />;
  if (!details)
    return (
      <Centered title="Loading pull request…" hint="Reading checks and reviews from GitHub." />
    );

  return (
    <div className="tab-pane">
      <div className="pr-card">
        <div className="head">
          <I.GitPR size={16} />
          <span className="num">#{details.number}</span>
          <span className="ttl">{details.title || pr.title}</span>
          <span className={`pr-pill ${stateClass(details.state, details.isDraft)}`}>
            {details.isDraft ? "draft" : details.state.toLowerCase()}
          </span>
        </div>
        <div className="body">
          <div className="tests-summary">
            <span className="item">
              <b style={{ color: "var(--c-done)" }}>+{details.additions}</b> added
            </span>
            <span className="item">
              <b style={{ color: "var(--c-danger)" }}>−{details.deletions}</b> removed
            </span>
          </div>

          <div className="pr-group">
            <div className="label">Checks</div>
            {details.checks.length === 0 ? (
              <div className="pr-muted">No checks reported.</div>
            ) : (
              details.checks.map((c) => {
                const Ico = CHECK_ICON[c.status] ?? I.Clock;
                return (
                  <div key={c.name} className={`check ${c.status}`}>
                    <span className="ic">
                      <Ico size={14} />
                    </span>
                    <span className="name">{c.name}</span>
                    <span className="meta">{c.meta || c.status}</span>
                  </div>
                );
              })
            )}
          </div>

          <div className="pr-group">
            <div className="label">Reviews</div>
            {details.reviews.length === 0 ? (
              <div className="pr-muted">No reviews yet.</div>
            ) : (
              details.reviews.map((r) => (
                <div key={`${r.who}-${r.when}-${r.action}`} className="review-line">
                  <span className="who">{r.who}</span>
                  <span className="what">{REVIEW_TEXT[r.action] ?? "reviewed"}</span>
                  <span className={`badge ${r.action === "approved" ? "approve" : "comment"}`}>
                    {r.action}
                  </span>
                  <span className="when">{relTime(r.when)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Centered({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty-state">
      <div className="inner">
        <div className="title">{title}</div>
        <div className="hint">{hint}</div>
      </div>
    </div>
  );
}
