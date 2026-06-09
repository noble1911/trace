import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { useBoardStore } from "@/domains/board/store";
import { resizeAgent } from "@/ipc/agent";
import { disposeTerminal, fitAndDiff, getTerminal } from "./terminalRegistry";

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

    // Fit to the visible host and tell the PTY the new geometry — but only when
    // the size actually changed (a same-size resize still raises SIGWINCH and
    // makes the TUI repaint over its banner).
    const reportSize = () => {
      const r = fitAndDiff(issueKey);
      if (r?.changed) void resizeAgent(issueKey, r.cols, r.rows);
    };
    reportSize();

    // The ResizeObserver fires in bursts — the detail entrance, removing the
    // start-overlay, and xterm's own fit→relayout feedback can ramp the size
    // across dozens of frames. Sending each to the PTY is a SIGWINCH storm that
    // makes the TUI repaint frantically and garble its banner. Debounce so the
    // PTY gets a single resize once the size settles.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(reportSize, 120);
    });
    ro.observe(host);

    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
      // Keep the terminal alive (just detach) if it's running OR has produced
      // any output — its scrollback is preserved for when we re-attach, since a
      // recreated terminal comes back blank (we never replay). Only dispose a
      // truly-empty, never-started terminal to avoid leaking one per visited card.
      if (useBoardStore.getState().runningAgents.has(issueKey) || entry.hasOutput) {
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
