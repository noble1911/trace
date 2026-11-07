import type { Os } from "../os.ts";

// Every shortcut trace has, in one list: what it does, where it works and its default
// keys per OS. Handlers ask `src/platform/shortcuts.ts` whether a key event is a given
// shortcut, and hints in the UI format its current binding, so a rebinding in Settings
// reaches both. Fixed ones are listed so Settings shows them and nothing is rebound
// over them; they can't be changed themselves.
//
// Off macOS `Ctrl` belongs to the terminal (Ctrl+C interrupts, Ctrl+K kills a line,
// Ctrl+J is a newline), so app shortcuts add Shift, as terminal emulators do there.
// Tab numbers stay Ctrl+1–9 (docs/WINDOWS_LINUX_PLAN.md, decision 3).

/**
 * Where a shortcut is listened for, which decides what it may collide with and what
 * keys it may take: `app` fires everywhere, terminals and text boxes included. `reply` is the Inbox's
 * reply box, `chat` a chat agent's composer, `settings` a list in Settings.
 */
export type Scope =
  | "app"
  | "detail"
  | "terminal"
  | "find"
  | "inbox"
  | "reply"
  | "chat"
  | "search"
  | "settings"
  | "mouse";

export type GroupId =
  | "app"
  | "detail"
  | "terminal"
  | "chat"
  | "inbox"
  | "search"
  | "board"
  | "settings";

export const GROUPS: { id: GroupId; label: string; desc: string }[] = [
  { id: "app", label: "Anywhere", desc: "Work on every page, in terminals too." },
  { id: "detail", label: "Agent and ticket views", desc: "While a session or ticket is open." },
  { id: "terminal", label: "Terminal", desc: "In an agent's chat or a shell terminal." },
  { id: "chat", label: "Agent chat", desc: "In a chat agent's message box." },
  { id: "inbox", label: "Inbox", desc: "On the Inbox page, when you aren't typing." },
  { id: "search", label: "Search box", desc: "While the search box has focus." },
  { id: "board", label: "Board", desc: "On a tracker's board." },
  { id: "settings", label: "Settings", desc: "In Settings → Sidebar's list of pages." },
];

export interface ShortcutDef {
  id: string;
  label: string;
  group: GroupId;
  scope: Scope;
  /** Default chords on macOS and elsewhere; the first is the one hints show. */
  mac: string[];
  pc: string[];
  /** Built in (system, terminal or text-box keys): shown, never rebound. */
  isFixed?: boolean;
}

const both = (chords: string[]) => ({ mac: chords, pc: chords });

export const SHORTCUTS: ShortcutDef[] = [
  {
    id: "orchestrator",
    label: "Show or fold the orchestrator",
    group: "app",
    scope: "app",
    mac: ["Meta+j"],
    pc: ["Ctrl+Shift+j"],
  },
  {
    id: "nextAgent",
    label: "Jump to the next agent needing you",
    group: "app",
    scope: "app",
    mac: ["Shift+Meta+n"],
    pc: ["Ctrl+Shift+n"],
  },
  {
    id: "search",
    label: "Search, or run an action",
    group: "app",
    scope: "app",
    mac: ["Meta+/", "Meta+k"],
    pc: ["Ctrl+Shift+k", "Ctrl+Shift+/"],
  },
  {
    id: "agentView",
    label: "Switch between transcript and terminal",
    group: "detail",
    scope: "detail",
    // macOS: ⌘ only. A focused terminal keeps ⌃⇧T, which reaches the TUI as ^T.
    mac: ["Shift+Meta+t"],
    pc: ["Ctrl+Shift+t"],
  },
  {
    id: "detailTab",
    label: "Switch to tab 1–9",
    group: "detail",
    scope: "detail",
    mac: ["Meta+#"],
    pc: ["Ctrl+#"],
  },
  {
    id: "quickOpen",
    label: "Quick Open a file in the worktree",
    group: "detail",
    scope: "detail",
    mac: ["Meta+p"],
    pc: ["Ctrl+Shift+p"],
  },
  {
    id: "detailBack",
    label: "Go back (not from inside a terminal)",
    group: "detail",
    scope: "detail",
    ...both(["Escape"]),
    isFixed: true,
  },
  {
    id: "termCopy",
    label: "Copy the selection",
    group: "terminal",
    scope: "terminal",
    mac: ["Meta+c"],
    pc: ["Ctrl+Shift+c"],
    isFixed: true,
  },
  {
    id: "termPaste",
    label: "Paste",
    group: "terminal",
    scope: "terminal",
    mac: ["Meta+v"],
    pc: ["Ctrl+Shift+v"],
    isFixed: true,
  },
  {
    id: "termNewline",
    label: "New line without sending",
    group: "terminal",
    scope: "terminal",
    ...both(["Shift+Enter"]),
    isFixed: true,
  },
  {
    id: "termFind",
    label: "Find in the terminal's scrollback",
    group: "terminal",
    scope: "terminal",
    // Off macOS WebView2 keeps Ctrl+F, and plain Ctrl is the terminal's anyway.
    mac: ["Meta+f"],
    pc: ["Ctrl+Shift+f"],
  },
  {
    id: "termFindMove",
    label: "Next or previous match (in the find bar)",
    group: "terminal",
    scope: "find",
    ...both(["Enter", "Shift+Enter"]),
    isFixed: true,
  },
  {
    id: "termCopyContext",
    label: "Copy the selection or last lines, saying where they came from",
    group: "terminal",
    scope: "terminal",
    mac: ["Shift+Meta+c"],
    pc: ["Ctrl+Shift+x"],
  },
  {
    id: "termLink",
    label: "Open a link while the app owns the mouse",
    group: "terminal",
    scope: "mouse",
    mac: ["Meta+Click", "Alt+Click"],
    pc: ["Ctrl+Click", "Alt+Click"],
    isFixed: true,
  },
  {
    id: "chatSend",
    label: "Send, or queue it while the agent works",
    group: "chat",
    scope: "chat",
    ...both(["Enter"]),
    isFixed: true,
  },
  {
    id: "chatNewline",
    label: "New line without sending",
    group: "chat",
    scope: "chat",
    ...both(["Shift+Enter"]),
    isFixed: true,
  },
  {
    id: "chatInterrupt",
    label: "Interrupt the agent's turn",
    group: "chat",
    scope: "chat",
    ...both(["Escape"]),
    isFixed: true,
  },
  {
    id: "inboxNext",
    label: "Next agent",
    group: "inbox",
    scope: "inbox",
    ...both(["j", "ArrowDown"]),
  },
  {
    id: "inboxPrev",
    label: "Previous agent",
    group: "inbox",
    scope: "inbox",
    ...both(["k", "ArrowUp"]),
  },
  {
    id: "inboxMoveDown",
    label: "Move the agent down the list",
    group: "inbox",
    scope: "inbox",
    ...both(["Alt+ArrowDown", "Alt+j"]),
  },
  {
    id: "inboxMoveUp",
    label: "Move the agent up the list",
    group: "inbox",
    scope: "inbox",
    ...both(["Alt+ArrowUp", "Alt+k"]),
  },
  { id: "inboxOpen", label: "Open the agent", group: "inbox", scope: "inbox", ...both(["Enter"]) },
  { id: "inboxDismiss", label: "Dismiss", group: "inbox", scope: "inbox", ...both(["e"]) },
  {
    id: "inboxAnswer",
    label: "Pick answer 1–9",
    group: "inbox",
    scope: "inbox",
    ...both(["#"]),
  },
  {
    id: "inboxSend",
    label: "Send a reply",
    group: "inbox",
    scope: "reply",
    ...both(["Enter"]),
    isFixed: true,
  },
  {
    id: "sendAndNext",
    label: "Send a reply and go to the next agent",
    group: "inbox",
    scope: "reply",
    mac: ["Meta+Enter"],
    pc: ["Ctrl+Enter"],
  },
  {
    id: "searchMove",
    label: "Move through results",
    group: "search",
    scope: "search",
    ...both(["ArrowDown", "ArrowUp"]),
    isFixed: true,
  },
  {
    id: "searchPick",
    label: "Open the result",
    group: "search",
    scope: "search",
    ...both(["Enter"]),
    isFixed: true,
  },
  {
    id: "searchEditor",
    label: "Open the file in your editor (Quick Open)",
    group: "search",
    scope: "search",
    ...both(["Shift+Enter"]),
    isFixed: true,
  },
  {
    id: "searchClose",
    label: "Close",
    group: "search",
    scope: "search",
    ...both(["Escape"]),
    isFixed: true,
  },
  {
    id: "sidebarMoveUp",
    label: "Move the page up the sidebar",
    group: "settings",
    scope: "settings",
    ...both(["Alt+ArrowUp"]),
    isFixed: true,
  },
  {
    id: "sidebarMoveDown",
    label: "Move the page down the sidebar",
    group: "settings",
    scope: "settings",
    ...both(["Alt+ArrowDown"]),
    isFixed: true,
  },
  {
    id: "typeFilterHide",
    label: "Hide an issue type (on its filter chip)",
    group: "board",
    scope: "mouse",
    ...both(["Alt+Click"]),
    isFixed: true,
  },
];

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

export function shortcutDef(id: string): ShortcutDef | undefined {
  return BY_ID.get(id);
}

/** Each shortcut's default chords on this OS. */
export function defaultsFor(id: string, os: Os): string[] {
  const def = BY_ID.get(id);
  if (!def) return [];
  return os === "macos" ? def.mac : def.pc;
}

/** User rebindings, by shortcut id: each replaces that shortcut's defaults. */
export type Overrides = Record<string, string[]>;

/** Every shortcut's chords on this OS, with the user's rebindings applied. */
export function effectiveKeymap(overrides: Overrides, os: Os): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const def of SHORTCUTS) {
    const own = def.isFixed ? undefined : overrides[def.id];
    out[def.id] = own && own.length > 0 ? own : defaultsFor(def.id, os);
  }
  return out;
}

/** Drop what isn't a rebinding of a known, rebindable shortcut (stored data is untrusted). */
export function cleanOverrides(raw: unknown): Overrides {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Overrides = {};
  for (const [id, chords] of Object.entries(raw)) {
    const def = BY_ID.get(id);
    if (!def || def.isFixed || !Array.isArray(chords)) continue;
    const valid = chords.filter((c): c is string => typeof c === "string" && c.length > 0);
    if (valid.length > 0) out[id] = valid;
  }
  return out;
}
