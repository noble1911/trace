import type { CSSProperties, ReactNode } from "react";
import { toast } from "@/app/toast";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import type { Issue } from "@/domains/jira/types";
import { browseUrl } from "@/domains/jira/url";
import { type Editor, openInEditor } from "@/ipc/editor";

const EDITORS: { id: Editor; label: string }[] = [
  { id: "vscode", label: "VS Code" },
  { id: "intellij", label: "IntelliJ" },
  { id: "cursor", label: "Cursor" },
];

interface ContextRailProps {
  issue: Issue;
  running: boolean;
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

export function ContextRail({ issue, running, site, repo }: ContextRailProps) {
  const slug = issue.key.toLowerCase();
  const issueUrl = browseUrl(site, issue.key);
  const epicUrl = issue.epicKey ? browseUrl(site, issue.epicKey) : undefined;

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
        {running ? (
          <>
            <div className="ctx-row">
              <span className="k">Status</span>
              <span className="v plain">
                <span className="thinking">working</span>
              </span>
            </div>
            <div className="ctx-row">
              <span className="k">Branch</span>
              <span className="v">workspace/{slug}</span>
            </div>
            <div className="ctx-row">
              <span className="k">Worktree</span>
              <span className="v">.worktrees/{slug}</span>
            </div>
          </>
        ) : (
          <div className="ctx-row">
            <span className="k">Status</span>
            <span className="v plain">not started</span>
          </div>
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
