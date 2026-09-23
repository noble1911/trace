import { useState } from "react";
import type { PrThread } from "@/ipc/prWatch";
import { PrEntryItem } from "./PrEntryItem";
import { entryFlag, usePrWatchStore } from "./watchStore";

/** Entries shown before "Show all" — the newest activity is what matters. */
const INITIAL = 6;

// A PR's discussion, newest activity first. Entries that are new or were edited
// since the user last looked (bots rewrite one comment in place) are flagged
// until hovered, opened, or cleared with "Mark read".
export function PrConversation({ pr }: { pr: PrThread }) {
  const [all, setAll] = useState(false);
  const [hideResolved, setHideResolved] = useState(true);
  const seen = usePrWatchStore((s) => s.seen[pr.url]);
  const markSeen = usePrWatchStore((s) => s.markSeen);

  const resolvedCount = pr.entries.filter((e) => e.resolved).length;
  const visible = pr.entries.filter((e) => !(hideResolved && e.resolved));
  const shown = all ? visible : visible.slice(0, INITIAL);
  const unseen = pr.entries.filter((e) => entryFlag(seen, e) !== null).length;

  return (
    <div className="pr-convo">
      <div className="pr-convo-head">
        <span className="label">Conversation</span>
        <span className="count">{pr.entries.length}</span>
        {unseen > 0 && (
          <button type="button" className="pr-link-btn" onClick={() => markSeen(pr.url)}>
            {unseen} changed · Mark read
          </button>
        )}
      </div>
      {pr.entries.length === 0 && <div className="pr-muted">No comments yet.</div>}
      {shown.map((e) => (
        <PrEntryItem
          key={e.id}
          entry={e}
          flag={entryFlag(seen, e)}
          onSeen={() => markSeen(pr.url, [e.id])}
        />
      ))}
      <div className="pr-convo-foot">
        {visible.length > INITIAL && (
          <button type="button" className="pr-link-btn" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${visible.length}`}
          </button>
        )}
        {resolvedCount > 0 && (
          <button
            type="button"
            className="pr-link-btn"
            onClick={() => setHideResolved(!hideResolved)}
          >
            {hideResolved ? `Show ${resolvedCount} resolved` : "Hide resolved"}
          </button>
        )}
      </div>
    </div>
  );
}
