import { useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { Markdown } from "@/components/Markdown";
import { runConversation } from "@/ipc/schedules";
import type { ConversationEntry, ScheduleRun } from "./types";

/** Clock time of an entry, when Claude recorded one. */
function timeOf(at?: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

// A run's turns, read from Claude's own conversation file. This is the readable
// view: the PTY recording can only replay the TUI's final screen (its alternate
// screen has no scrollback), so long runs were unreadable there.
export function RunConversation({ run }: { run: ScheduleRun }) {
  const [entries, setEntries] = useState<ConversationEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  // Re-read as a live run progresses: each turn (and its background tasks
  // reporting back) appends to the file.
  const revision = `${run.status}:${run.backgroundTasks}:${run.summary.length}`;

  // `revision` isn't read in the body — it's the trigger: a live run's file grows
  // with every turn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read whenever the run moves on
  useEffect(() => {
    let cancelled = false;
    runConversation(run.id)
      .then((loaded) => {
        if (cancelled) return;
        setEntries(loaded);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [run.id, revision]);

  if (error) {
    return (
      <div className="empty-state">
        <div className="inner">
          <div className="title">Conversation unavailable</div>
          <div className="hint">{error} The Terminal tab still has the recorded output.</div>
        </div>
      </div>
    );
  }
  if (!entries) return <div className="sched-log-loading">Reading the conversation…</div>;

  const toolCount = entries.filter((e) => e.kind === "tool").length;
  const shown = showTools ? entries : entries.filter((e) => e.kind !== "tool");

  return (
    <div className="sched-log">
      {toolCount > 0 && (
        <button type="button" className="sched-log-toggle" onClick={() => setShowTools((v) => !v)}>
          <I.Chevron size={12} /> {showTools ? "Hide" : "Show"} {toolCount} tool call
          {toolCount === 1 ? "" : "s"}
        </button>
      )}
      {shown.map((entry, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: log entries are positional and never reordered
        <div key={i} className={`sched-log-entry ${entry.kind}`}>
          <span className="sched-log-when">{timeOf(entry.at)}</span>
          <div className="sched-log-body">
            {entry.kind === "reply" ? (
              <Markdown text={entry.text} />
            ) : entry.kind === "tool" ? (
              <span className="sched-log-tool">
                <span className="name">{entry.tool}</span>
                {entry.text}
              </span>
            ) : (
              <span className="sched-log-text">{entry.text}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
