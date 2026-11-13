import { useEffect, useMemo, useState } from "react";
import { KeyHint } from "@/components/KeyHint";
import { Markdown } from "@/components/Markdown";
import { ChatPrompts } from "@/domains/agentChat/PendingPrompts";
import { useJournal } from "@/domains/agentChat/store";
import { useIsChatAgent } from "@/domains/agentChat/transport";
import { isWaitingOnYou } from "@/domains/agentChat/waiting";
import { choicesFor } from "@/domains/live/answer";
import type { LiveEntry } from "@/domains/live/entries";
import { ageLabel, shownAsk } from "@/domains/live/light";
import { useSessionsOverview } from "@/domains/sessions/hooks/useSessionsOverview";
import { type DiffSummary, gitDiffSummary } from "@/ipc/diff";
import { basename } from "@/platform/paths";
import { useAriaKeys, useTitleWithHint } from "@/platform/shortcuts";
import { AskCard } from "./AskCard";
import { ReplyBox } from "./ReplyBox";

const OPEN_WHAT = { ticket: "ticket", session: "session", scheduled: "run" } as const;

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
  onDismiss: () => void;
  onSentNext: () => void;
}

// The selected agent: what it wants, what it last said, what it changed, and a
// way to answer — enough to unblock it without opening its terminal.
export function InboxDetail({ entry, now, onOpen, onDismiss, onSentNext }: InboxDetailProps) {
  const { info } = entry;
  const ask = shownAsk(info);
  const dismissTitle = useTitleWithHint("Dismiss", "inboxDismiss");
  const dismissKeys = useAriaKeys("inboxDismiss");
  const openTitle = useTitleWithHint(`Open ${OPEN_WHAT[entry.source]}`, "inboxOpen");
  const openKeys = useAriaKeys("inboxOpen");
  // A chat agent's prompts are its own cards, answered over the chat protocol.
  const isChat = useIsChatAgent(entry.id);
  // One primary per screen: while the card here offers an answer (a chat prompt,
  // or a terminal menu's choices), that answer is it, and Open is a plain button.
  const chatRows = useJournal(entry.id).rows;
  const chatWaits = useMemo(() => isChat && isWaitingOnYou(chatRows), [isChat, chatRows]);
  const answersHere = isChat ? chatWaits : choicesFor(ask).length > 0;
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
            <button type="button" className="ib-title-link" onClick={onOpen}>
              {entry.title}
            </button>
          </h2>
        </div>
        {ask && (
          <button
            type="button"
            className="btn"
            onClick={onDismiss}
            title={`${dismissTitle}: takes it out of Needs you. This doesn't answer the agent.`}
            aria-keyshortcuts={dismissKeys}
          >
            Dismiss <KeyHint id="inboxDismiss" />
          </button>
        )}
        <button
          type="button"
          className={answersHere ? "btn" : "btn primary"}
          onClick={onOpen}
          title={openTitle}
          aria-keyshortcuts={openKeys}
        >
          Open {OPEN_WHAT[entry.source]} <KeyHint id="inboxOpen" />
        </button>
      </div>

      {ask && !isChat && (
        <AskCard workspaceId={entry.id} ask={ask} age={ageLabel(info.since, now)} />
      )}
      {isChat && <ChatPrompts workspaceId={entry.id} />}

      {info.lastMessage && (
        <section className="ib-card">
          <div className="ib-lbl">Last message</div>
          <Markdown text={info.lastMessage} prose />
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
              <div className="ib-dim">
                and {diff.files.length - 6} more {diff.files.length === 7 ? "file" : "files"}
              </div>
            )}
          </div>
        </section>
      )}

      {info.light !== "stopped" && (
        <ReplyBox
          key={entry.id}
          workspaceId={entry.id}
          pendingKind={info.ask?.kind ?? null}
          chat={isChat}
          onSentNext={onSentNext}
        />
      )}
    </section>
  );
}
