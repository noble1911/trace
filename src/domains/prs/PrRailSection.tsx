import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import type { PrThread } from "@/ipc/prWatch";
import { PrConversation } from "./PrConversation";
import { relTime } from "./relTime";
import { usePrWatchStore } from "./watchStore";

const CHECKS_TEXT = { ok: "Checks passing", fail: "Checks failing", pending: "Checks running" };
const DECISION_TEXT = {
  approved: "Approved",
  changes: "Changes requested",
  review: "Review required",
};

/** "acme/web#12" — enough to tell two PRs apart at a glance. */
function shortRef(url: string): string {
  const m = url.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
  return m ? `${m[1]}#${m[2]}` : url;
}

function copyLink(url: string) {
  void navigator.clipboard.writeText(url).then(
    () => toast.success("Copied PR link"),
    () => toast.error("Couldn't copy to clipboard")
  );
}

function Summary({ pr }: { pr: PrThread }) {
  return (
    <div className="pr-summary">
      <button type="button" className="pr-summary-title" onClick={() => void openUrl(pr.url)}>
        <span className="num">#{pr.number}</span> {pr.title}
      </button>
      <div className="pr-summary-meta">
        <span className={`pr-pill ${pr.state}`}>{pr.state}</span>
        <span className="branch" title={`${pr.headRef} → ${pr.baseRef}`}>
          {pr.headRef} → {pr.baseRef}
        </span>
      </div>
      <div className="pr-summary-meta">
        <span className="diffstat">
          <b className="add">+{pr.additions}</b> <b className="del">−{pr.deletions}</b>
        </span>
        {pr.checks && (
          <span className={`pr-status ${pr.checks}`}>
            <span className="dot" /> {CHECKS_TEXT[pr.checks]}
          </span>
        )}
        {pr.reviewDecision && (
          <span className={`pr-status ${pr.reviewDecision}`}>
            {DECISION_TEXT[pr.reviewDecision]}
          </span>
        )}
      </div>
      <div className="pr-summary-links">
        <button type="button" className="open-btn" onClick={() => void openUrl(pr.url)}>
          <I.GitPR size={12} /> Open on GitHub
        </button>
        <button type="button" className="open-btn" onClick={() => void openUrl(`${pr.url}/files`)}>
          <I.Code size={12} /> Files
        </button>
        <button type="button" className="open-btn" onClick={() => copyLink(pr.url)}>
          <I.Copy size={12} /> Copy link
        </button>
      </div>
      <div className="pr-summary-foot">
        by {pr.author} · updated {relTime(pr.updatedAt)}
      </div>
    </div>
  );
}

// The rail's "Pull requests" section: every PR the workspace raised (found by
// `usePrWatch` — branch + conversation, not just whatever scrolled past in the
// terminal), the selected one's status and links, then its live conversation.
export function PrRailSection({ urls }: { urls: string[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const threads = usePrWatchStore((s) => s.threads);
  const errors = usePrWatchStore((s) => s.errors);
  if (urls.length === 0) return null;

  // Prefer an explicit pick, then the first still-open PR, then the first.
  const openOne = urls.find((u) => {
    const st = threads[u]?.state;
    return st === "open" || st === "draft";
  });
  const selected = picked && urls.includes(picked) ? picked : (openOne ?? urls[0]);
  const pr = threads[selected];

  return (
    <div className="ctx-section pr-rail">
      <div className="label">Pull requests</div>
      {urls.length > 1 && (
        <div className="linked-list pr-picker">
          {urls.map((u) => {
            const t = threads[u];
            return (
              <button
                type="button"
                key={u}
                className={`pr-rail-row${u === selected ? " active" : ""}`}
                onClick={() => setPicked(u)}
                title={t?.title ?? u}
              >
                <I.GitPR size={13} style={{ color: "var(--fg-3)" }} />
                <span className="num">{shortRef(u)}</span>
                <span className="pr-row-title">{t?.title ?? ""}</span>
                {t && <span className={`pr-pill ${t.state}`}>{t.state}</span>}
              </button>
            );
          })}
        </div>
      )}
      {pr ? (
        <>
          <Summary pr={pr} />
          <PrConversation pr={pr} />
        </>
      ) : errors[selected] ? (
        <div className="pr-muted" title={errors[selected]}>
          Couldn't read {shortRef(selected)} from GitHub — is <code>gh</code> signed in?
        </div>
      ) : (
        <div className="pr-muted">Loading {shortRef(selected)}…</div>
      )}
    </div>
  );
}
