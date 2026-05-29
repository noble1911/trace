import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { useBoardStore } from "@/domains/board/store";
import { resizeAgent, sendAgentInput } from "@/ipc/agent";

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// xterm.js measures glyphs in its own hidden DOM elements, which fall outside any
// `var(--font-mono)` CSS scope — using the variable there ends up resolving to a
// generic monospace whose metrics don't match the canvas font, producing stretched
// columns. Pass the literal font stack instead (mirrors tokens.css).
const PTY_FONT = '"Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

// Renders the interactive Claude/Codex TUI for one issue. The raw PTY bytes are
// captured app-wide by App.tsx into the board store's `outputBuffers` keyed by
// workspace id — this component just replays them on mount and watches the store
// for new chunks, so navigating away and back preserves the scrollback.
export function PtyTerminal({ issueKey }: { issueKey: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: PTY_FONT,
      fontSize: 12,
      cursorBlink: true,
      theme: { background: "#050505", foreground: "#ededed", cursor: "#ededed" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const reportSize = () => {
      try {
        fit.fit();
        void resizeAgent(issueKey, term.cols, term.rows);
      } catch {
        // host not measurable yet — the ResizeObserver will fire again
      }
    };
    reportSize();

    // Subscribe to the store BEFORE replaying so any chunks that arrive mid-mount
    // are picked up. Replay then writes everything captured so far; subsequent
    // updates only write the delta after `lastSeen`.
    let lastSeen = 0;
    const writeFrom = (chunks: string[]) => {
      while (lastSeen < chunks.length) {
        term.write(decodeBase64(chunks[lastSeen]));
        lastSeen++;
      }
    };
    const unsubBuffer = useBoardStore.subscribe((state) => {
      writeFrom(state.outputBuffers[issueKey] ?? []);
    });
    writeFrom(useBoardStore.getState().outputBuffers[issueKey] ?? []);

    const inputSub = term.onData((data) => void sendAgentInput(issueKey, data));
    const ro = new ResizeObserver(reportSize);
    ro.observe(host);

    return () => {
      unsubBuffer();
      ro.disconnect();
      inputSub.dispose();
      term.dispose();
    };
  }, [issueKey]);

  return (
    <div className="pty-pane">
      <div ref={hostRef} style={{ height: "100%" }} />
    </div>
  );
}
