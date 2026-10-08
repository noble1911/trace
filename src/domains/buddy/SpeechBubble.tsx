import { useEffect } from "react";
import { useBoardStore } from "@/domains/board/store";
import { useBuddyStore } from "./store";

/** Long enough to read, short enough not to linger: ~60ms a character, 5–12s. */
function readMs(text: string): number {
  return Math.min(12_000, Math.max(5_000, 2_000 + text.length * 60));
}

// The buddy's speech bubble, floating out of the rail over the main view. Fades
// on its own; clicking it opens the ticket it's about (or just dismisses it).
export function SpeechBubble() {
  const bubble = useBuddyStore((s) => s.bubble);
  const dismiss = useBuddyStore((s) => s.dismiss);
  const openIssue = useBoardStore((s) => s.openIssue);

  useEffect(() => {
    if (!bubble) return;
    const timer = window.setTimeout(dismiss, readMs(bubble.text));
    return () => window.clearTimeout(timer);
  }, [bubble, dismiss]);

  if (!bubble) return null;
  const open = () => {
    if (bubble.issueKey) openIssue(bubble.issueKey);
    dismiss();
  };
  return (
    <button
      key={bubble.id}
      type="button"
      className={`buddy-bubble${bubble.issueKey ? " link" : ""}`}
      onClick={open}
      title={bubble.issueKey ? `Open ${bubble.issueKey}` : "Dismiss"}
    >
      {bubble.text}
      {bubble.issueKey && <span className="go">{bubble.issueKey} →</span>}
    </button>
  );
}
