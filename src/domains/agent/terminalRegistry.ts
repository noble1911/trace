import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { type OutputChunk, useBoardStore } from "@/domains/board/store";
import { ptySnapshot, resizeAgent, sendAgentInput } from "@/ipc/agent";
import { useRichOutputStore } from "./richOutputStore";
import { termFontFamily, termFontSize, termLineHeight } from "./terminalPrefs";

/**
 * Open a link surfaced in terminal output in the system browser. The webview
 * can't `window.open` (Tauri blocks it), so clicks route through the opener
 * plugin — and only for http(s): terminal bytes are untrusted, and other
 * schemes (file:, custom app handlers) could do more than open a page.
 */
function openLink(uri: string) {
  if (/^https?:\/\//i.test(uri)) void openUrl(uri);
}

// xterm paints to a canvas and can't resolve CSS variables, so these mirror
// tokens.css (--bg-0 / --fg-1). If the tokens change, change these too.
// (The font has the same constraint — see `terminalPrefs.ts`.)
const PTY_BG = "#050505"; // --bg-0
const PTY_FG = "#ededed"; // --fg-1

// Private OSC opcode the agent uses to ship base64-encoded HTML to the companion
// panel out-of-band (OSC 7700 ; base64(html) ST). Bypasses the character grid
// entirely — see the handler in `getTerminal`.
const RICH_HTML_OSC = 7700;

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
   * High-water mark from a history replay: live chunks with seq at or below
   * this are already on screen (the snapshot contained them) and are skipped.
   */
  skipSeq: number;
  /**
   * Generation counter, bumped by `resetTerminal` (i.e. a fresh spawn). The
   * `ptySnapshot` replay in `getTerminal` is async; if the terminal is reset and
   * the session respawned while that fetch is in flight, the late `.then` must
   * NOT apply the old history — doing so repaints stale bytes and, worse, sets
   * `skipSeq` to the *old* run's high-water mark, which makes the pump swallow
   * the new run's first chunks (its seq restarts at 1) → a blank/garbled chat.
   * The replay captures this value up front and bails if it no longer matches.
   */
  epoch: number;
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
    fontFamily: termFontFamily(),
    fontSize: termFontSize(),
    lineHeight: termLineHeight(),
    cursorBlink: true,
    theme: { background: PTY_BG, foreground: PTY_FG, cursor: PTY_FG },
    // OSC 8 hyperlinks (gh and modern CLIs emit these) are ignored by xterm
    // unless a handler is set.
    linkHandler: { activate: (_event, uri) => openLink(uri) },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Plain-text URLs (PR links in agent output) become clickable. Disposed
  // with the terminal — loadAddon ties the addon's lifetime to it.
  term.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)));

  // Out-of-band HTML channel: the agent prints OSC 7700 ; base64(html) ST and we
  // swallow it here so it never paints into the grid, decode the payload, and
  // hand the raw HTML to the rich-output store; the panel renders it in a
  // sandboxed iframe. The handler is disposed with the parser on `term.dispose()`.
  term.parser.registerOscHandler(RICH_HTML_OSC, (payload) => {
    try {
      const html = new TextDecoder().decode(decodeBase64(payload));
      useRichOutputStore.getState().push(issueKey, html);
    } catch {
      // Drop a malformed marker rather than corrupt the screen.
    }
    return true; // handled — never falls through to the grid renderer
  });

  // Shift+Enter inserts a newline instead of submitting. A terminal can't
  // natively tell Shift+Enter from Enter (both are \r), so we do what Claude
  // Code's /terminal-setup installs in VS Code: send backslash+CR — Claude's
  // line-continuation idiom, and conveniently also the shell's. (ESC CR /
  // meta+enter was tried first but current Claude builds submit on it.)
  term.attachCustomKeyEventHandler((e) => {
    if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Inject once on keydown, but swallow EVERY phase: WebKit also fires a
      // keypress for Enter, and xterm would emit its own \r from it — which
      // submitted the line right after our newline (the "double press" feel).
      if (e.type === "keydown") void sendAgentInput(issueKey, "\\\r");
      return false;
    }
    return true;
  });

  const entry: TerminalEntry = {
    term,
    fit,
    container,
    opened: false,
    lastSeen: 0,
    skipSeq: 0,
    epoch: 0,
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
  const pump = (chunks: OutputChunk[]) => {
    while (entry.lastSeen < chunks.length) {
      const chunk = chunks[entry.lastSeen];
      entry.lastSeen++;
      // Skip what a history replay already painted (seq handoff) — an event
      // can arrive after the snapshot that already contained its bytes.
      if (chunk.seq <= entry.skipSeq) continue;
      term.write(decodeBase64(chunk.data));
      entry.hasOutput = true;
    }
  };
  entry.lastSeen = (useBoardStore.getState().outputBuffers[issueKey] ?? []).length;
  entry.unsub = useBoardStore.subscribe((s) => pump(s.outputBuffers[issueKey] ?? []));

  registry.set(issueKey, entry);

  // A brand-new terminal for a workspace with prior output (renderer reload
  // killed the old one): replay the backend's rolling history. Replay is only
  // safe at the size the bytes were painted for, so size first, write, then
  // re-fit to the actual pane (xterm reflows the buffer on resize).
  const snapshotEpoch = entry.epoch;
  void ptySnapshot(issueKey)
    .then((snap) => {
      if (!snap || snap.chunks.length === 0) return;
      // Bail if the terminal was reset/respawned (epoch bumped) or disposed and
      // re-created (no longer the registered entry) while we were fetching —
      // applying the old history now would repaint stale bytes and poison
      // skipSeq, swallowing the fresh session's first chunks.
      if (registry.get(issueKey) !== entry || entry.epoch !== snapshotEpoch) return;
      // Live bytes already hit this terminal — replaying underneath them
      // would garble; fall back to live-only (the TUI repaints on fit).
      if (entry.hasOutput) return;
      entry.term.resize(snap.cols, snap.rows);
      for (const chunk of snap.chunks) {
        entry.term.write(decodeBase64(chunk));
      }
      entry.skipSeq = snap.seq;
      entry.hasOutput = true;
      const r = fitAndDiff(issueKey);
      if (r?.changed) void resizeAgent(issueKey, r.cols, r.rows);
      entry.term.refresh(0, entry.term.rows - 1);
    })
    .catch(() => {});

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
  // A fresh spawn resets the backend's seq counter too — a stale high-water
  // mark would silently swallow the new session's first chunks.
  entry.skipSeq = 0;
  entry.hasOutput = false;
  // Invalidate any in-flight ptySnapshot replay (see `epoch`): a late replay
  // would otherwise clobber the just-started session.
  entry.epoch++;
  // NB: rendered HTML cards are deliberately NOT cleared here — they outlive a
  // stop/start so the user can return to past diagrams (cleared only on request,
  // via the HTML tab's Clear action).
}

/**
 * Push the current presentation prefs into every live terminal. Terminals
 * outlive Settings (the registry keeps them across navigation), so changes
 * must be applied in place. New metrics change cols/rows, so each visible
 * terminal is refitted and its PTY resized — with the same changed-size guard
 * as `fitAndDiff` (a same-size SIGWINCH makes TUIs repaint over themselves).
 */
export function applyTerminalPrefs(): void {
  const fontFamily = termFontFamily();
  const fontSize = termFontSize();
  const lineHeight = termLineHeight();
  for (const [key, entry] of registry) {
    entry.term.options.fontFamily = fontFamily;
    entry.term.options.fontSize = fontSize;
    entry.term.options.lineHeight = lineHeight;
    if (!entry.opened) continue;
    try {
      // A detached container measures 0×0 and fit() is a no-op — the next
      // mount's fitAndDiff picks up the new metrics instead.
      entry.fit.fit();
      const { cols, rows } = entry.term;
      const changed =
        !entry.lastSent || entry.lastSent.cols !== cols || entry.lastSent.rows !== rows;
      entry.lastSent = { cols, rows };
      if (changed) void resizeAgent(key, cols, rows);
    } catch {
      // Not measurable — leave geometry to the next mount.
    }
  }
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
  // Rendered HTML cards are intentionally kept (persisted) so they survive a
  // teardown — see the note in `resetTerminal`.
}
