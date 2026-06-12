import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useBoardStore } from "@/domains/board/store";

interface LinkTicketModalProps {
  onClose: () => void;
  /** Called with the chosen issue key; the caller performs the link. */
  onPick: (issueKey: string) => void;
}

// Pick a board ticket to bind this session to. The session's worktree,
// branch, and Claude conversation become the ticket's workspace.
export function LinkTicketModal({ onClose, onPick }: LinkTicketModalProps) {
  const issues = useBoardStore((s) => s.data?.issues ?? []);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches = issues
    .filter((i) => !q || `${i.key} ${i.summary}`.toLowerCase().includes(q))
    .slice(0, 8);

  return (
    <Modal title="Link to ticket" onClose={onClose}>
      <div className="field">
        <label htmlFor="link-ticket-q">Ticket</label>
        <input
          id="link-ticket-q"
          // biome-ignore lint/a11y/noAutofocus: the modal exists solely for this input
          autoFocus
          placeholder="Search your sprint…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="hint">
          This session's worktree, branch, and conversation become the ticket's workspace.
        </span>
      </div>
      <div className="link-ticket-list">
        {matches.length === 0 && <div className="pr-muted">No matching tickets.</div>}
        {matches.map((i) => (
          <button
            type="button"
            key={i.key}
            className="link-ticket-row"
            onClick={() => onPick(i.key)}
          >
            <span className="ticket">{i.key}</span>
            <span className="ttl">{i.summary}</span>
            <span className="st">{i.statusName}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
