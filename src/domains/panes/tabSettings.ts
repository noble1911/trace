import { create } from "zustand";

// The workspace tabs that come and go, what each is for, and which of trace's agent
// tools fill it. Settings → Tabs turns each on or off: an off tab never shows or
// appears in the pane menu, and its tools aren't offered to agents (nor run if an
// agent already has them). Off is remembered; everything is on by default.

export interface OptionalTab {
  /** The panel id (Plan's is still "html", the tab it replaced). */
  id: string;
  label: string;
  /** What it shows, for Settings. */
  about: string;
  /** trace's agent tools that put things in it. */
  tools: string[];
}

export const OPTIONAL_TABS: OptionalTab[] = [
  {
    id: "html",
    label: "Plan",
    about: "What an agent planned in plan mode, and documents it publishes, with versions.",
    tools: ["publish_document"],
  },
  {
    id: "browser",
    label: "Browser",
    about: "Pages an agent opens, like its dev server, or docs you open yourself.",
    tools: ["open_browser"],
  },
  {
    id: "gallery",
    label: "Gallery",
    about: "Folders of images: screenshots, charts or icons an agent made, or one you open.",
    tools: ["show_images"],
  },
  {
    id: "files",
    label: "Files",
    about: "What the agent changed, and every file in the worktree.",
    tools: [],
  },
  {
    id: "terminal",
    label: "Terminal",
    about: "A shell in the workspace, beside its agent.",
    tools: [],
  },
  {
    id: "tests",
    label: "Tests",
    about: "Runs the worktree's tests (cargo, npm, gradle, maven, go or pytest).",
    tools: [],
  },
  {
    id: "pr",
    label: "Pull request",
    about: "The pull requests from the workspace, with checks and review threads.",
    tools: [],
  },
];

const KEY = "trace.tabsOff";

function load(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const AUTO_CLOSE_KEY = "trace.subagentTabsAutoClose";

/** Whether finished subagents' unseen tabs close by themselves: on unless turned off. */
function loadAutoClose(): boolean {
  try {
    return localStorage.getItem(AUTO_CLOSE_KEY) !== "off";
  } catch {
    return true;
  }
}

interface TabSettings {
  /** Tabs turned off. */
  off: string[];
  setOn: (id: string, on: boolean) => void;
  /** A finished subagent's tab closes after a while if it was never shown. */
  autoCloseSubagents: boolean;
  setAutoCloseSubagents: (on: boolean) => void;
}

export const useTabSettings = create<TabSettings>((set) => ({
  off: load(),
  autoCloseSubagents: loadAutoClose(),
  setAutoCloseSubagents(on) {
    try {
      localStorage.setItem(AUTO_CLOSE_KEY, on ? "on" : "off");
    } catch {
      // A view preference: it still applies this run.
    }
    set({ autoCloseSubagents: on });
  },
  setOn(id, on) {
    set((s) => {
      const off = on ? s.off.filter((t) => t !== id) : [...new Set([...s.off, id])];
      try {
        localStorage.setItem(KEY, JSON.stringify(off));
      } catch {
        // A view preference: it still applies this run.
      }
      return { off };
    });
  },
}));

/** Whether tab `id` is on (any tab not listed here always is). */
export function isTabOn(off: readonly string[], id: string): boolean {
  return !off.includes(id);
}

/** The agent tools of tabs that are off. */
export function offTools(off: readonly string[]): Set<string> {
  return new Set(OPTIONAL_TABS.filter((t) => off.includes(t.id)).flatMap((t) => t.tools));
}

/** The tab a tool fills, for refusing a call to an off one. */
export function tabOfTool(tool: string): OptionalTab | undefined {
  return OPTIONAL_TABS.find((t) => t.tools.includes(tool));
}

/** `panels` without the tabs that are off. */
export function useOnTabs<T extends { id: string }>(panels: T[]): T[] {
  const off = useTabSettings((s) => s.off);
  return off.length === 0 ? panels : panels.filter((p) => isTabOn(off, p.id));
}

import.meta.hot?.accept(() => location.reload());
