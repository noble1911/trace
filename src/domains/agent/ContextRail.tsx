import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import type { Issue } from "@/domains/jira/types";

interface ContextRailProps {
  issue: Issue;
  running: boolean;
  site: string | null;
  /** The repo this ticket is assigned to (absolute path). */
  repo?: string;
}

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// The stored site may include a protocol (even a malformed `https//`) and/or a
// path — reduce it to a bare host so the browse link is always well-formed.
function hostOf(site: string): string {
  return site
    .trim()
    .replace(/^https?:?\/\/?/i, "")
    .replace(/\/.*$/, "");
}

export function ContextRail({ issue, running, site, repo }: ContextRailProps) {
  const slug = issue.key.toLowerCase();
  const issueUrl = site ? `https://${hostOf(site)}/browse/${issue.key}` : undefined;

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

      <div className="ctx-section" style={{ flex: 1 }}>
        <div className="label">Linked</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          <a
            className="ctx-row"
            href={issueUrl}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "none", color: "var(--fg-1)" }}
          >
            <I.Ticket size={13} style={{ color: "var(--fg-3)" }} />
            <span style={{ fontFamily: "var(--font-mono)" }}>{issue.key}</span>
            <span style={{ color: "var(--fg-3)", marginLeft: 4 }}>Jira</span>
          </a>
        </div>
      </div>
    </div>
  );
}
