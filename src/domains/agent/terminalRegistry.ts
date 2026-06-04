import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useBoardStore } from "@/domains/board/store";
import { sendAgentInput } from "@/ipc/agent";

// xterm.js measures glyphs in its own hidden DOM elements, which fall outside any
// `var(--font-mono)` CSS scope — using the variable there resolves to a generic
// monospace whose metrics don't match the canvas font, producing stretched
// columns. Pass the literal font stack instead (mirrors tokens.css).
const PTY_FONT = '"Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * A persistent xterm bound to one issue's PTY. A full-screen TUI's byte stream is
 * only valid applied *incrementally to a live terminal* — replaying it into a
 * fresh terminal corrupts every in-place redraw. So we keep the `Terminal` alive
 * for the whole session and only move its DOM between hosts when the user
 * navigates; the screen state is never rebuilt from scratch.
 */
interface TerminalEntry {
  term: Terminal;
  fit: FitAddon;
  /** The xterm host. We re-parent this node between mounts (never re-`open`). */
  container: HTMLDivElement;
  /** True once `term.open(container)` has run (only valid in the DOM). */
  opened: boolean;
  /** How many buffered chunks we've already written (monotonic, no double-write). */
  lastSeen: number;
  unsub: () => void;
  inputSub: { dispose(): void };
}

const registry = new Map<string, TerminalEntry>();

/**
 * Get (or lazily create) the live terminal for an issue. Creation wires the
 * store→terminal pump and keyboard input, but defers `term.open` until the
 * caller attaches the container to the DOM (xterm can only measure when parented).
 */
export function getTerminal(issueKey: string): TerminalEntry {
  const existing = registry.get(issueKey);
  if (existing) return existing;

  const container = document.createElement("div");
  container.style.height = "100%";
  container.style.width = "100%";

  const term = new Terminal({
    fontFamily: PTY_FONT,
    fontSize: 12,
    cursorBlink: true,
    theme: { background: "#050505", foreground: "#ededed", cursor: "#ededed" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);

  const entry: TerminalEntry = {
    term,
    fit,
    container,
    opened: false,
    lastSeen: 0,
    unsub: () => {},
    inputSub: term.onData((data) => void sendAgentInput(issueKey, data)),
  };

  // Drain only the chunks we haven't written yet. Because the terminal is created
  // at session start (empty buffer) and then kept alive across navigation, this
  // only ever writes *live* bytes — it never re-replays history, so the in-place
  // redraws always land correctly.
  const pump = (chunks: string[]) => {
    while (entry.lastSeen < chunks.length) {
      term.write(decodeBase64(chunks[entry.lastSeen]));
      entry.lastSeen++;
    }
  };
  pump(useBoardStore.getState().outputBuffers[issueKey] ?? []);
  entry.unsub = useBoardStore.subscribe((s) => pump(s.outputBuffers[issueKey] ?? []));

  registry.set(issueKey, entry);
  return entry;
}

/**
 * Fit the terminal to its current host and return the resulting cols/rows.
 * Returns null if the terminal isn't measurable yet (not in a laid-out DOM node).
 */
export function fitTerminal(issueKey: string): { cols: number; rows: number } | null {
  const entry = registry.get(issueKey);
  if (!entry?.opened) return null;
  try {
    entry.fit.fit();
    return { cols: entry.term.cols, rows: entry.term.rows };
  } catch {
    return null;
  }
}

/**
 * Wipe the screen + scrollback and rewind the write cursor so a fresh `start`
 * (which clears `outputBuffers`) repaints into a clean terminal.
 */
export function resetTerminal(issueKey: string): void {
  const entry = registry.get(issueKey);
  if (!entry) return;
  entry.term.reset();
  entry.lastSeen = 0;
}

/** Tear down a session's terminal entirely (store sub, input, renderer, DOM). */
export function disposeTerminal(issueKey: string): void {
  const entry = registry.get(issueKey);
  if (!entry) return;
  entry.unsub();
  entry.inputSub.dispose();
  entry.term.dispose();
  entry.container.remove();
  registry.delete(issueKey);
}
