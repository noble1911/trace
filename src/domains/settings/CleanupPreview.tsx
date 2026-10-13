import { I } from "@/components/Icon";
import { relTime } from "@/domains/sessions/time";
import type { CleanupReport } from "@/ipc/cleanup";

interface CleanupPreviewProps {
  /** null while the first preview is loading. */
  report: CleanupReport | null;
  busy: boolean;
  onRun: () => void;
}

// What the auto-cleanup rules select right now: the workspaces the next pass
// will delete, plus any it has to keep (running, uncommitted work) and why.
export function CleanupPreview({ report, busy, onRun }: CleanupPreviewProps) {
  if (!report) return <span className="hint">Checking workspaces…</span>;
  const deletable = report.items.filter((it) => !it.held);
  if (report.items.length === 0) {
    return <span className="hint">Nothing matches these rules right now.</span>;
  }
  return (
    <div className="cleanup-preview">
      <div className="cleanup-preview-head">
        <span className="hint">
          {deletable.length === 0
            ? "Matching workspaces are being kept:"
            : `The next pass deletes ${deletable.length} workspace${deletable.length === 1 ? "" : "s"}:`}
        </span>
        {deletable.length > 0 && (
          <button type="button" className="btn" onClick={onRun} disabled={busy}>
            <I.Archive size={13} /> {busy ? "Cleaning up…" : "Clean up now"}
          </button>
        )}
      </div>
      <div className="repo-list">
        {report.items.map((it) => (
          <div key={it.path} className="repo-row">
            {it.kind === "ticket" ? <I.Ticket size={14} /> : <I.Chat size={14} />}
            <span className="repo-name">{it.label}</span>
            <span className="repo-path" title={it.path}>
              last active {relTime(it.lastActive)}
            </span>
            {it.held && (
              <span className="wt-chip dirty" title={`Kept: ${it.held}`}>
                kept — {it.held}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
