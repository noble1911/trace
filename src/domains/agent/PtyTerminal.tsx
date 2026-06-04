import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { useBoardStore } from "@/domains/board/store";
import { resizeAgent } from "@/ipc/agent";
import { disposeTerminal, getTerminal } from "./terminalRegistry";

// Renders the interactive Claude/Codex TUI for one issue. The actual xterm lives
// in `terminalRegistry` and stays alive for the whole session — this component
// only *re-parents* it into the visible host on mount and detaches it on unmount.
//
// That's the crux of the fix: a full-screen TUI's byte stream can't be replayed
// into a fresh terminal without corrupting every in-place redraw. By keeping one
// live terminal and never rebuilding it, scrollback and the status line stay
// correct across navigation, and there is no spawn-time resize to double-paint
// the banner (the session is started at this terminal's measured size).
export function PtyTerminal({ issueKey }: { issueKey: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const entry = getTerminal(issueKey);
    host.appendChild(entry.container);
    // xterm can only `open` (and measure fonts) once it's in a laid-out DOM node,
    // so we defer the very first open to here. Subsequent mounts just move the
    // already-opened container — the renderer travels with the node.
    if (!entry.opened) {
      entry.term.open(entry.container);
      entry.opened = true;
    }

    // Fit to the visible host and tell the PTY the new geometry. The ResizeObserver
    // re-runs this whenever the pane changes (window resize, rail toggle, etc.).
    const reportSize = () => {
      try {
        entry.fit.fit();
        void resizeAgent(issueKey, entry.term.cols, entry.term.rows);
      } catch {
        // host not measurable yet — the ResizeObserver will fire again
      }
    };
    reportSize();

    const ro = new ResizeObserver(reportSize);
    ro.observe(host);

    return () => {
      ro.disconnect();
      // While a session is live, only detach — the terminal keeps consuming
      // output via its store subscription so the screen is intact when we
      // re-attach. If nothing is running (never started, or already stopped),
      // there's nothing to preserve, so dispose to avoid leaking an empty term.
      if (useBoardStore.getState().runningAgents.has(issueKey)) {
        entry.container.remove();
      } else {
        disposeTerminal(issueKey);
      }
    };
  }, [issueKey]);

  return (
    <div className="pty-pane">
      <div ref={hostRef} style={{ height: "100%" }} />
    </div>
  );
}
