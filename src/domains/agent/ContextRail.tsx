import { openUrl } from "@tauri-apps/plugin-opener";
import type { CSSProperties, ReactNode } from "react";
import { toast } from "@/app/toast";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { type SessionStatus, useBoardStore } from "@/domains/board/store";
import type { Issue, PullRequest } from "@/domains/jira/types";
import { browseUrl } from "@/domains/jira/url";
import { type Editor, openInEditor } from "@/ipc/editor";

// Stable empty reference so the store selector doesn't return a fresh array
// each render (which would churn re-renders).
const EMPTY_PRS: PullRequest[] = [];

/** Map a dev-status PR state to the `.pr-pill` colour variant. */
function pillClass(state: string): string {
  const s = state.toLowerCase();
  if (s === "merged") return "merged";
  if (s === "draft") return "draft";
  if (s === "declined" || s === "closed") return "closed";
  return "open";
}

const EDITORS: { id: Editor; label: string }[] = [
  { id: "vscode", label: "VS Code" },
  { id: "intellij", label: "IntelliJ" },
  { id: "cursor", label: "Cursor" },
];

interface ContextRailProps {
  issue: Issue;
  status: SessionStatus;
  site: string | null;
  /** The repo this ticket is assigned to (absolute path). */
  repo?: string;
}

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

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

// One linked reference (the issue, its epic): a key that opens in Jira, an
// optional sub-label, and a copy button for pasting the key into the chat.
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

export function ContextRail({ issue, status, site, repo }: ContextRailProps) {
  const slug = issue.key.toLowerCase();
  const live = status !== "idle";
  const issueUrl = browseUrl(site, issue.key);
  const epicUrl = issue.epicKey ? browseUrl(site, issue.epicKey) : undefined;
  const prs = useBoardStore((s) => s.pullRequests[issue.key] ?? EMPTY_PRS);

  const openEditor = (editor: Editor) => {
    void openInEditor(issue.key, editor).catch((e) => toast.error(String(e)));
  };

  return (
    <div className="detail-right">
      <div className="ctx-section">
        <div className="label">Assignee</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AgentAvatar assignee={issue.assignee} size="xl" />
          <div>
            <h3 style={{ marginBottom: 2 }}>{issue.assignee?.displayName ?? "Unassigned"}</h3>
            <div style={{ color: "var(--fg-3)", fontSize: 12 }}>{issue.issueType}</div>
          </div>
        </div>
      </div>

      <div className="ctx-section">
        <div className="label">Claude session</div>
        {repo && (
          <div className="ctx-row">
            <span className="k">Repository</span>
            <span className="v" title={repo}>
              {basename(repo)}
            </span>
          </div>
        )}
        <div className="ctx-row">
          <span className="k">Status</span>
          <span className="v plain">
            {status === "working" && <span className="thinking">working</span>}
            {status === "waiting" && <span className="waiting">waiting for input</span>}
            {status === "idle" && "not started"}
          </span>
        </div>
        {live && (
          <>
            <div className="ctx-row">
              <span className="k">Branch</span>
              <span className="v">workspace/{slug}</span>
            </div>
            <div className="ctx-row">
              <span className="k">Worktree</span>
              <span className="v">.worktrees/{slug}</span>
            </div>
          </>
        )}
      </div>

      <div className="ctx-section">
        <div className="label">Open in</div>
        <div className="open-in">
          {EDITORS.map((ed) => (
            <button
              key={ed.id}
              type="button"
              className="open-btn"
              onClick={() => openEditor(ed.id)}
              title={`Open the worktree in ${ed.label}`}
            >
              <I.Code size={12} /> {ed.label}
            </button>
          ))}
        </div>
      </div>

      {prs.length > 0 && (
        <div className="ctx-section">
          <div className="label">Pull requests</div>
          <div className="linked-list">
            {prs.map((pr) => (
              <button
                type="button"
                key={pr.url}
                className="pr-rail-row"
                onClick={() => void openUrl(pr.url)}
                title={pr.title || `Open PR #${pr.number} on GitHub`}
              >
                <I.GitPR size={13} style={{ color: "var(--fg-3)" }} />
                <span className="num">#{pr.number}</span>
                <span className={`pr-pill ${pillClass(pr.state)}`}>{pr.state}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ctx-section" style={{ flex: 1 }}>
        <div className="label">Linked</div>
        <div className="linked-list">
          <LinkedRow icon={I.Ticket} keyText={issue.key} sub="Jira" url={issueUrl} />
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
