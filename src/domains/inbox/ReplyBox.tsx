import { type KeyboardEvent, useState } from "react";
import { toast } from "@/app/toast";
import { reply, TERMINAL_ONLY } from "@/domains/live/answer";
import type { AskKind } from "@/domains/live/types";

interface ReplyBoxProps {
  workspaceId: string;
  /** What's pending — a permission/plan menu is dismissed before the message goes. */
  pendingKind: AskKind | null;
  /** ⌘⏎: send, then move to the next agent that needs you. */
  onSentNext: () => void;
}

// Talk to the agent without opening its terminal. ⏎ sends; ⌘⏎ sends and moves on.
export function ReplyBox({ workspaceId, pendingKind, onSentNext }: ReplyBoxProps) {
  const [text, setText] = useState("");
  const send = (thenNext: boolean) => {
    if (!text.trim()) return;
    const message = text;
    setText("");
    reply(workspaceId, message, pendingKind)
      .then(() => {
        if (thenNext) onSentNext();
      })
      .catch((err) => {
        setText(message);
        toast.error(`Couldn't send: ${err}`);
      });
  };
  if (pendingKind && TERMINAL_ONLY.has(pendingKind)) {
    return (
      <div className="ib-reply ib-reply-off">
        It's asking a multiple-choice question — open it to answer in the terminal.
      </div>
    );
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send(e.metaKey);
  };
  return (
    <label className="ib-reply">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          pendingKind === "permission"
            ? "Or tell the agent what to do instead…"
            : "Reply without opening the terminal…"
        }
        aria-label="Reply to the agent"
      />
      <span className="ib-reply-hint">
        <span className="kbd">⏎</span> send · <span className="kbd">⌘⏎</span> send &amp; next
      </span>
    </label>
  );
}
