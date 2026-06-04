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
//
// The PTY's *current* cols/rows are also tracked in the store. On remount we
// resize xterm to that size BEFORE replaying so the buffered bytes (which were
// written by the TUI assuming those dims) render with the correct line wraps and
// cursor positions. We only fit-to-host *after* the replay finishes — that
// reflows the visible content and sends a fresh resize to the PTY.
export function PtyTerminal({ issueKey }: { issueKey: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Recover the PTY's last known dims so the buffered bytes get rendered at
    // their original geometry. Defaults to 80x24 (matches the spawn default).
    const storedSize = useBoardStore.getState().agentSizes[issueKey];
    const initialCols = storedSize?.cols ?? 80;
    const initialRows = storedSize?.rows ?? 24;

    const term = new Terminal({
      cols: initialCols,
      rows: initialRows,
      fontFamily: PTY_FONT,
      fontSize: 12,
      cursorBlink: true,
      theme: { background: "#050505", foreground: "#ededed", cursor: "#ededed" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // Subscribe BEFORE replay so any chunks that arrive mid-mount are picked up;
    // the lastSeen counter advances monotonically so we never double-write.
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
    // Replay everything captured so far — at the initial cols/rows above, so
    // historical content renders with the same wrapping the TUI emitted.
    writeFrom(useBoardStore.getState().outputBuffers[issueKey] ?? []);

    // Only NOW fit to host. fit.fit() resizes xterm to the visible host dims;
    // xterm v6 reflows the visible viewport on resize, while scrollback above
    // keeps its original wrapping (which is what we want — it was rendered at
    // those dims). The PTY also gets the new size so the TUI repaints fresh.
    const setAgentSize = useBoardStore.getState().setAgentSize;
    const reportSize = () => {
      try {
        fit.fit();
        const { cols, rows } = term;
        void resizeAgent(issueKey, cols, rows);
        setAgentSize(issueKey, cols, rows);
      } catch {
        // host not measurable yet — the ResizeObserver will fire again
      }
    };
    reportSize();

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
