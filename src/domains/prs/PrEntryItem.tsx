import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { I } from "@/components/Icon";
import type { PrComment, PrEntry } from "@/ipc/prWatch";
import { GithubMarkdown } from "./GithubMarkdown";
import { relTime } from "./relTime";
import type { EntryFlag } from "./watchStore";

const REVIEW_LABEL: Record<string, string> = {
  approved: "approved",
  changes: "requested changes",
  commented: "reviewed",
  dismissed: "review dismissed",
};

/** "edited 2m ago" when the latest thing that happened was an edit. */
function when(c: PrComment): string {
  if (c.editedAt && c.editedAt > c.createdAt) return `edited ${relTime(c.editedAt)}`;
  return relTime(c.createdAt);
}

function Author({ c }: { c: PrComment }) {
  return (
    <span className="pr-entry-who">
      {c.author}
      {c.isBot && <span className="pr-bot">bot</span>}
    </span>
  );
}

/** A comment body clamped to a few lines, expandable in place. */
function Body({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const body = text.trim();
  if (!body) return null;
  const long = body.length > 280 || body.split("\n").length > 6;
  return (
    <div className={`pr-entry-body${long && !open ? " clamped" : ""}`}>
      <GithubMarkdown text={body} />
      {long && (
        <button type="button" className="pr-more" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

interface PrEntryItemProps {
  entry: PrEntry;
  flag: EntryFlag;
  onSeen: () => void;
}

// One conversation item: a comment, a review verdict, or an inline code thread
// (with its replies folded under it). Clicking the header opens it on GitHub.
export function PrEntryItem({ entry, flag, onSeen }: PrEntryItemProps) {
  const [showReplies, setShowReplies] = useState(false);
  const open = () => {
    onSeen();
    if (entry.url) void openUrl(entry.url);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-to-acknowledge is a convenience; the header button is the keyboard path
    <div
      className={`pr-entry${flag ? ` flag-${flag}` : ""}${entry.resolved ? " resolved" : ""}`}
      onMouseLeave={flag ? onSeen : undefined}
    >
      <button type="button" className="pr-entry-head" onClick={open} title="Open on GitHub">
        <Author c={entry} />
        {entry.kind === "review" && entry.reviewState && (
          <span className={`pr-verdict ${entry.reviewState}`}>
            {REVIEW_LABEL[entry.reviewState]}
          </span>
        )}
        <span className="pr-entry-when">{when(entry)}</span>
        {flag && <span className={`pr-flag ${flag}`}>{flag}</span>}
      </button>
      {entry.kind === "thread" && entry.path && (
        <div className="pr-entry-path">
          <I.File size={11} />
          <span className="file">
            {entry.path}
            {entry.line ? `:${entry.line}` : ""}
          </span>
          {entry.resolved && <span className="pr-tag">resolved</span>}
          {entry.outdated && <span className="pr-tag">outdated</span>}
        </div>
      )}
      <Body text={entry.body} />
      {entry.replies.length > 0 && (
        <>
          <button
            type="button"
            className="pr-replies-toggle"
            onClick={() => setShowReplies(!showReplies)}
          >
            <span className={`pr-chev${showReplies ? " open" : ""}`}>
              <I.Chevron size={11} />
            </span>
            {entry.replies.length} {entry.replies.length === 1 ? "reply" : "replies"}
            <span className="pr-entry-when">· latest {relTime(entry.activityAt)}</span>
          </button>
          {showReplies &&
            entry.replies.map((r) => (
              <div key={r.id} className="pr-reply">
                <button
                  type="button"
                  className="pr-entry-head"
                  onClick={() => r.url && void openUrl(r.url)}
                  title="Open on GitHub"
                >
                  <Author c={r} />
                  <span className="pr-entry-when">{when(r)}</span>
                </button>
                <Body text={r.body} />
              </div>
            ))}
        </>
      )}
    </div>
  );
}
