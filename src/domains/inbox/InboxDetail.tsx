import { useEffect, useState } from "react";
import type { LiveEntry } from "@/domains/live/entries";
import { ageLabel, shownAsk } from "@/domains/live/light";
import { useSessionsOverview } from "@/domains/sessions/hooks/useSessionsOverview";
import { type DiffSummary, gitDiffSummary } from "@/ipc/diff";
import { AskCard } from "./AskCard";
import { ReplyBox } from "./ReplyBox";

const OPEN_WHAT = { ticket: "ticket", session: "session", scheduled: "run" } as const;

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

/** The worktree's changes vs its base — refetched when the agent's state moves on. */
function useDiff(worktreeId: string | null, refreshKey: string | null): DiffSummary | null {
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the refetch trigger — a finished turn usually means new edits
  useEffect(() => {
    setDiff(null);
    if (!worktreeId) return;
    let cancelled = false;
    gitDiffSummary(worktreeId)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [worktreeId, refreshKey]);
  return diff;
}

interface InboxDetailProps {
  entry: LiveEntry;
  now: number;
  onOpen: () => void;
  onSentNext: () => void;
}

// The selected agent: what it wants, what it last said, what it changed, and a
// way to answer — enough to unblock it without opening its terminal.
export function InboxDetail({ entry, now, onOpen, onSentNext }: InboxDetailProps) {
  const { info } = entry;
  const ask = shownAsk(info);
  const overview = useSessionsOverview(entry.worktreeId ? [entry.worktreeId] : [])[
    entry.worktreeId ?? ""
  ];
  // A new closing message means a turn ended — likely with new edits.
  const diff = useDiff(entry.worktreeId, info.lastMessage);
  const add = diff?.files.reduce((n, f) => n + f.add, 0) ?? 0;
  const del = diff?.files.reduce((n, f) => n + f.del, 0) ?? 0;
  const where = [overview ? basename(overview.repo) : null, overview?.branch]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="ib-detail" aria-label={`${entry.title} — details`}>
      <div className="ib-detail-head">
        <div className="ib-detail-id">
          <div className="ib-meta">
            <span className="mono">{entry.subtitle}</span>
            {where && <span className="mono">· {where}</span>}
          </div>
          <h2>
            <button type="button" className="ib-title-link" onClick={onOpen} title="Open">
              {entry.title}
            </button>
          </h2>
        </div>
        <button type="button" className="btn primary" onClick={onOpen}>
          Open {OPEN_WHAT[entry.source]} <span className="kbd">⏎</span>
        </button>
      </div>

      {ask && <AskCard workspaceId={entry.id} ask={ask} age={ageLabel(info.since, now)} />}

      {info.lastMessage && (
        <section className="ib-card">
          <div className="ib-lbl">Last message</div>
          <p className="ib-said">{info.lastMessage}</p>
        </section>
      )}

      {diff && diff.files.length > 0 && (
        <section className="ib-card">
          <div className="ib-card-head">
            <span className="ib-lbl">Changes</span>
            <span className="mono ib-stat">
              <span className="add">+{add}</span> <span className="del">−{del}</span>
            </span>
            <span className="ib-dim">
              · {diff.files.length} file{diff.files.length === 1 ? "" : "s"} · against {diff.base}
            </span>
          </div>
          <div className="ib-files mono">
            {diff.files.slice(0, 6).map((f) => (
              <div key={f.path} className="ib-file">
                <span className="ib-path" title={f.path}>
                  {f.path}
                </span>
                <span>
                  {f.add > 0 && <span className="add">+{f.add}</span>}{" "}
                  {f.del > 0 && <span className="del">−{f.del}</span>}
                </span>
              </div>
            ))}
            {diff.files.length > 6 && (
              <div className="ib-dim">and {diff.files.length - 6} more — open Files to see all</div>
            )}
          </div>
        </section>
      )}

      {info.light !== "stopped" && (
        <ReplyBox
          key={entry.id}
          workspaceId={entry.id}
          pendingKind={info.ask?.kind ?? null}
          onSentNext={onSentNext}
        />
      )}
    </section>
  );
}
