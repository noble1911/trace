import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useBoardStore } from "@/domains/board/store";
import { sendAgentInput } from "@/ipc/agent";

// xterm.js measures glyphs in its own hidden DOM elements, which fall outside any
// `var(--font-mono)` CSS scope — using the variable there resolves to a generic
// monospace whose metrics don't match the canvas font, producing stretched
// columns. Pass the literal font stack instead (mirrors tokens.css).
const PTY_FONT = '"Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

// Same constraint for colors: xterm paints to a canvas and can't resolve CSS
// variables, so these mirror tokens.css (--bg-0 / --fg-1). If the tokens change,
// change these too.
const PTY_BG = "#050505"; // --bg-0
const PTY_FG = "#ededed"; // --fg-1

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
  /**
   * Whether this terminal has ever rendered output. A terminal with scrollback is
   * kept alive across navigation even after the agent stops, so its history is
   * preserved (we never replay, so a disposed terminal comes back blank). Only
   * truly-empty, never-started terminals are disposed on unmount.
   */
  hasOutput: boolean;
  /**
   * Last cols/rows we told the PTY about. A resize triggers SIGWINCH and the TUI
   * repaints on *any* SIGWINCH — even a same-size one — which lands a duplicate
   * banner over the first paint. So we only resize when the size actually
   * changed; this records what we last sent.
   */
  lastSent: { cols: number; rows: number } | null;
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
    theme: { background: PTY_BG, foreground: PTY_FG, cursor: PTY_FG },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);

  const entry: TerminalEntry = {
    term,
    fit,
    container,
    opened: false,
    lastSeen: 0,
    hasOutput: false,
    lastSent: null,
    unsub: () => {},
    inputSub: term.onData((data) => void sendAgentInput(issueKey, data)),
  };

  // Write only *live* bytes from here on — never replay history. A full-screen
  // TUI's past output can't be re-applied to a fresh terminal without garbling
  // (its in-place redraws/resize-repaints land at the wrong width → duplicated
  // banners). At a normal session start the buffer is empty so this is a no-op;
  // if the terminal is recreated mid-session (dev HMR, a reload), we skip the
  // stale history and PtyTerminal's mount-time resize makes the TUI repaint the
  // current screen cleanly. Scrollback across navigation is preserved a
  // different way — the terminal is kept alive (detached), not recreated.
  const pump = (chunks: string[]) => {
    while (entry.lastSeen < chunks.length) {
      term.write(decodeBase64(chunks[entry.lastSeen]));
      entry.lastSeen++;
      entry.hasOutput = true;
    }
  };
  entry.lastSeen = (useBoardStore.getState().outputBuffers[issueKey] ?? []).length;
  entry.unsub = useBoardStore.subscribe((s) => pump(s.outputBuffers[issueKey] ?? []));

  registry.set(issueKey, entry);
  return entry;
}

/**
 * Fit the terminal to its host for a *spawn*: records the size as last-sent
 * (the PTY is about to be created at it) so PtyTerminal's first post-spawn
 * resize is recognised as a no-op and skipped. Returns null if not measurable.
 */
export function fitTerminal(issueKey: string): { cols: number; rows: number } | null {
  const entry = registry.get(issueKey);
  if (!entry?.opened) return null;
  try {
    entry.fit.fit();
    const size = { cols: entry.term.cols, rows: entry.term.rows };
    entry.lastSent = size;
    return size;
  } catch {
    return null;
  }
}

/**
 * Fit to the host and report whether the size *changed* since the last resize we
 * sent the PTY. Callers resize the PTY only when `changed` — a same-size resize
 * still raises SIGWINCH and makes the TUI repaint over itself (duplicate banner).
 */
export function fitAndDiff(
  issueKey: string
): { cols: number; rows: number; changed: boolean } | null {
  const entry = registry.get(issueKey);
  if (!entry?.opened) return null;
  try {
    entry.fit.fit();
    const { cols, rows } = entry.term;
    const changed = !entry.lastSent || entry.lastSent.cols !== cols || entry.lastSent.rows !== rows;
    entry.lastSent = { cols, rows };
    return { cols, rows, changed };
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
  entry.hasOutput = false;
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
