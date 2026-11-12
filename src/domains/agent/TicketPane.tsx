import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { I } from "@/components/Icon";
import { Markdown } from "@/components/Markdown";
import { useBoardStore } from "@/domains/board/store";
import { TicketCardActions, TicketCardEditor } from "@/domains/boards/TicketCardActions";
import type { Issue } from "@/domains/issues/types";
import { issueBrowseUrl, jiraBrowseUrl } from "@/domains/issues/url";
import { TicketComments } from "./ticket/TicketComments";
import { TicketProps } from "./ticket/TicketProps";

interface TicketPaneProps {
  issue: Issue;
  /** The Jira site, for links to the ticket and its epic. */
  site: string | null;
}

// The "Ticket" tab: the issue as a document to read. Its key and type, title and
// fields, then the description and the discussion as the tracker has them (Jira's
// rich text arrives as Markdown, `jira::adf`). Where the agent is and its PRs stay
// in the Details panel. A custom board's card (trace's own) is edited and deleted here.
export function TicketPane({ issue, site }: TicketPaneProps) {
  const isCustom = useBoardStore((s) => s.provider === "custom");
  // Keyed by card, so moving to another ticket leaves the editor behind.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editing = isCustom && editingKey === issue.key;
  const issueUrl = issueBrowseUrl(issue, site);
  const epicUrl = issue.epicKey ? jiraBrowseUrl(site, issue.epicKey) : undefined;
  const description = issue.description?.trim();

  return (
    <div className="tk">
      <article className="tk-doc">
        <div className="tk-meta">
          <I.Ticket size={14} />
          {issueUrl ? (
            <button
              type="button"
              className="tk-key"
              onClick={() => void openUrl(issueUrl)}
              title={`Open ${issue.key} in the tracker`}
            >
              {issue.key}
              <I.External size={12} />
            </button>
          ) : (
            <span className="tk-key">{issue.key}</span>
          )}
          <span className="tk-dot" aria-hidden>
            ·
          </span>
          <span>{issue.issueType}</span>
          {isCustom && (
            <TicketCardActions
              issue={issue}
              editing={editing}
              onToggleEdit={() => setEditingKey(editing ? null : issue.key)}
            />
          )}
        </div>
        {editing ? (
          <TicketCardEditor issue={issue} onDone={() => setEditingKey(null)} />
        ) : (
          <>
            <h1 className="tk-title">{issue.summary}</h1>

            <TicketProps issue={issue} epicUrl={epicUrl} />

            <section className="tk-section" aria-label="Description">
              <h2 className="tk-label">Description</h2>
              {description ? (
                <Markdown text={description} className="tk-desc" />
              ) : (
                <div className="tk-empty">No description.</div>
              )}
            </section>
          </>
        )}

        <TicketComments issue={issue} />
      </article>
    </div>
  );
}
