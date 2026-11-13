import { useBoardStore } from "@/domains/board/store";
import { useCheatSheet } from "@/domains/cheatSheet/store";
import { useIssuesStore } from "@/domains/issues/store";
import { choicesFor, choose } from "@/domains/live/answer";
import { orderIds } from "@/domains/live/order";
import { useLiveStore } from "@/domains/live/store";
import { workspaceTitle } from "@/domains/sessions/agentRoster";
import { useSessionsStore } from "@/domains/sessions/store";
import { pinnedPages } from "@/domains/sidebar/items";
import { useSidebarStore } from "@/domains/sidebar/store";
import { stopAgent } from "@/ipc/agent";
import { hint } from "@/platform/shortcuts";
import { isNavAvailable, NAV_LABELS, type NavId } from "./nav";
import { openWorkspace } from "./openWorkspace";
import { toast } from "./toast";
import { nextNeedingYou } from "./useGlobalKeys";

/** Something the palette can do, rather than find. */
export interface Command {
  id: string;
  /** "needs" rows lead the palette; "action" rows follow. */
  group: "needs" | "action";
  label: string;
  /** Muted context after the label (a ticket title, an ask). */
  sub?: string;
  kbd?: string;
  run: () => void;
}

const MAX_ISSUE_ACTIONS = 4;
const NAV_ORDER: NavId[] = [
  "inbox",
  "board",
  "pylon",
  "boards",
  "fleet",
  "sessions",
  "scheduled",
  "pr",
  "activity",
  "integrations",
  "settings",
];

function titleOf(id: string): string {
  const issue = useBoardStore.getState().data?.issues.find((i) => i.key === id);
  if (issue) return `${issue.key} · ${issue.summary}`;
  return workspaceTitle(useSessionsStore.getState().sessions, id) ?? id;
}

/**
 * The palette's commands for `query`: agents that need you (each with "open",
 * plus "allow" on a permission prompt), then actions — start or stop agents,
 * go to a page, jump to the next agent needing you. Empty query = the defaults.
 */
export function buildCommands(query: string, setNav: (nav: NavId) => void): Command[] {
  const q = query.trim().toLowerCase();
  const matches = (text: string) => q === "" || text.toLowerCase().includes(q);
  const out: Command[] = [];
  const { info, manualOrder } = useLiveStore.getState();
  const order = orderIds(Object.keys(info), (id) => info[id].openedAt, manualOrder);

  for (const id of order) {
    const live = info[id];
    // "attention" is only ever an agent with a pending ask (`lightOf`).
    if (live.light !== "attention" || !live.ask) continue;
    const title = titleOf(id);
    const ask = live.ask.label;
    if (!matches(`${title} ${ask}`)) continue;
    out.push({
      id: `open:${id}`,
      group: "needs",
      label: title,
      sub: ask,
      run: () => openWorkspace(id, setNav),
    });
    const allowOnce = live.ask.kind === "permission" ? choicesFor(live.ask)[0] : undefined;
    if (allowOnce) {
      out.push({
        id: `allow:${id}`,
        group: "needs",
        label: `Allow once — ${title}`,
        sub: ask,
        run: () =>
          void choose(id, allowOnce)
            .then(() => toast.success("Allowed"))
            .catch((err) => toast.error(`Couldn't answer: ${err}`)),
      });
    }
  }

  if (matches("next agent needing you")) {
    out.push({
      id: "next-needs",
      group: "action",
      label: "Next agent needing you",
      kbd: hint("nextAgent"),
      run: () => {
        const next = nextNeedingYou();
        if (next) openWorkspace(next, setNav);
        else toast.info("Nothing needs you right now");
      },
    });
  }

  if (matches("keyboard shortcuts keys cheat sheet help")) {
    out.push({
      id: "cheat-sheet",
      group: "action",
      label: "Keyboard shortcuts",
      kbd: hint("cheatSheet"),
      run: () => useCheatSheet.getState().show(),
    });
  }

  const board = useBoardStore.getState();
  if (q.length >= 2) {
    let n = 0;
    for (const issue of board.data?.issues ?? []) {
      if (n >= MAX_ISSUE_ACTIONS) break;
      const hay = `${issue.key} ${issue.summary}`;
      if (!hay.toLowerCase().includes(q)) continue;
      n++;
      if (board.runningAgents.has(issue.key)) {
        out.push({
          id: `stop:${issue.key}`,
          group: "action",
          label: `Stop agent on ${issue.key}`,
          sub: issue.summary,
          run: () => void stopAgent(issue.key).catch((e) => toast.error(String(e))),
        });
      } else {
        out.push({
          id: `start:${issue.key}`,
          group: "action",
          label: `Start agent on ${issue.key}`,
          sub: issue.summary,
          run: () => board.kickoff(issue.key, "user"),
        });
      }
    }
  }

  // Every page it can show, hidden from the rail or not (Settings → Sidebar).
  const trackers = useIssuesStore.getState().sessions;
  const pinned = pinnedPages(useSidebarStore.getState().entries);
  for (const nav of NAV_ORDER.filter((n) => isNavAvailable(n, trackers, pinned))) {
    const label = `Go to ${NAV_LABELS[nav]}`;
    if (matches(label))
      out.push({ id: `nav:${nav}`, group: "action", label, run: () => setNav(nav) });
  }
  return out;
}
