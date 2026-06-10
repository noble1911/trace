import type { Issue } from "@/domains/jira/types";

// The "Ticket" tab — the linked Jira issue's fields.
export function TicketPane({ issue }: { issue: Issue }) {
  const paragraphs = (issue.description ?? "").split(/\n{2,}/).filter((p) => p.trim());
  // Key by content + occurrence count: descriptions can repeat a line (e.g. a
  // "---" separator), and duplicate keys make React silently drop paragraphs.
  const seen = new Map<string, number>();
  const keyed = paragraphs.map((text) => {
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return { text, key: `${n}:${text}` };
  });

  return (
    <div className="tab-pane">
      <div className="ticket-section">
        <h2>{issue.summary}</h2>
        {issue.labels.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {issue.labels.map((l) => (
              <span key={l} className="tag">
                {l}
              </span>
            ))}
          </div>
        )}
        <div className="ticket-desc">
          {keyed.length > 0 ? (
            keyed.map(({ text, key }) => <p key={key}>{text}</p>)
          ) : (
            <p style={{ color: "var(--fg-3)" }}>No description.</p>
          )}
        </div>
        <div className="ticket-grid">
          <div>
            <div className="k">Type</div>
            <div className="v">{issue.issueType}</div>
          </div>
          <div>
            <div className="k">Status</div>
            <div className="v">{issue.statusName}</div>
          </div>
          <div>
            <div className="k">Reporter</div>
            <div className="v">{issue.reporter ?? "—"}</div>
          </div>
          <div>
            <div className="k">Priority</div>
            <div className="v">{issue.priority.toUpperCase()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
