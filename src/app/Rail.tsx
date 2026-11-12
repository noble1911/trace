import type { CSSProperties, ReactNode } from "react";
import { AppLogo } from "@/components/AppLogo";
import { I } from "@/components/Icon";
import { RailBoards } from "@/domains/boards/RailBoards";
import { Buddy } from "@/domains/buddy/Buddy";
import { useBuddyStore } from "@/domains/buddy/store";
import { useCheatSheet } from "@/domains/cheatSheet/store";
import { useIssuesStore } from "@/domains/issues/store";
import { useScheduledNeedsYou } from "@/domains/schedules/hooks/useScheduledNeedsYou";
import { RailRecents } from "@/domains/sessions/RailRecents";
import { BOARD_GROUP, groupedRailItems, type RailItem } from "@/domains/sidebar/boardGroup";
import { useSidebarStore } from "@/domains/sidebar/store";
import { useAriaKeys, useTitleWithHint } from "@/platform/shortcuts";
import type { NavId } from "./nav";
import { RAIL_ICONS } from "./railIcons";

interface RailProps {
  nav: NavId;
  onNav: (nav: NavId) => void;
  /** Agents that need you — the inbox's badge. */
  waitingCount: number;
}

/** Each page's tooltip (the inbox's also says how many need you). */
const TITLES: Record<NavId, string> = {
  inbox: "Inbox",
  board: "Board",
  pylon: "Pylon",
  boards: "Boards",
  fleet: "Fleet — every running agent",
  sessions: "Sessions",
  scheduled: "Scheduled prompts",
  pr: "Pull requests",
  activity: "Activity",
  integrations: "Integrations",
  settings: "Settings",
};

interface RailButtonProps {
  id: NavId;
  active: boolean;
  onNav: (nav: NavId) => void;
  title?: string;
  label?: string;
  badge?: ReactNode;
  style?: CSSProperties;
}

function RailButton({ id, active, onNav, title, label, badge, style }: RailButtonProps) {
  const Icon = RAIL_ICONS[id];
  return (
    <button
      type="button"
      className={`nav-btn${active ? " active" : ""}`}
      onClick={() => onNav(id)}
      title={title ?? TITLES[id]}
      aria-label={label ?? title ?? TITLES[id]}
      style={style}
    >
      <Icon size={16} />
      {badge}
    </button>
  );
}

export function Rail({ nav, onNav, waitingCount }: RailProps) {
  // Prefer the Jira identity for the rail avatar; fall back to any provider, or none.
  const user = useIssuesStore((s) => s.users.jira ?? s.users.pylon ?? null);
  // Which pages show, and in what order, is the user's (Settings → Sidebar). By default
  // a tracker's pages show only while it's connected (`domains/sidebar/items.ts`).
  const trackers = useIssuesStore((s) => s.sessions);
  const entries = useSidebarStore((s) => s.entries);
  const recentsFlyout = useSidebarStore((s) => s.recentsFlyout);
  const recentsDelay = useSidebarStore((s) => s.recentsDelay);
  const groupBoards = useSidebarStore((s) => s.groupBoards);
  const scheduledNeedsYou = useScheduledNeedsYou();
  const buddyOn = useBuddyStore((s) => s.enabled);
  const showCheatSheet = useCheatSheet((s) => s.show);
  const cheatTitle = useTitleWithHint("Keyboard shortcuts", "cheatSheet");
  const cheatKeys = useAriaKeys("cheatSheet");

  const button = (id: RailItem) => {
    // The board pages as one button (Settings → Sidebar), with your boards beneath it.
    if (id === BOARD_GROUP) return <RailBoards key={id} nav={nav} onNav={onNav} />;
    const active = nav === id;
    if (id === "inbox") {
      const n = waitingCount;
      return (
        <RailButton
          key={id}
          id={id}
          active={active}
          onNav={onNav}
          title={n > 0 ? `Inbox — ${n} need you` : "Inbox"}
          label={n > 0 ? `Inbox, ${n} need you` : "Inbox"}
          badge={n > 0 && <span className="badge count">{n}</span>}
        />
      );
    }
    if (id === "sessions") {
      // While Sessions is selected, resting on it slides out its recent sessions
      // (when that's turned on in Settings → Sidebar).
      return (
        <div
          key={id}
          className="rail-group"
          style={{ "--rr-delay": `${recentsDelay}ms` } as CSSProperties}
        >
          <RailButton id={id} active={active} onNav={onNav} />
          {active && recentsFlyout && <RailRecents />}
        </div>
      );
    }
    const badge = id === "scheduled" && scheduledNeedsYou && <span className="badge" />;
    return <RailButton key={id} id={id} active={active} onNav={onNav} badge={badge} />;
  };

  return (
    <aside className="rail">
      <div className="logo">
        <AppLogo size={32} />
      </div>
      <nav className="nav">{groupedRailItems(entries, trackers, groupBoards).map(button)}</nav>
      {buddyOn && <Buddy />}
      {/* The help: every shortcut (also ? and the palette's "Keyboard shortcuts"). */}
      <button
        type="button"
        className="nav-btn"
        onClick={showCheatSheet}
        title={cheatTitle}
        aria-label="Keyboard shortcuts"
        aria-keyshortcuts={cheatKeys}
        style={{ marginTop: "auto" }}
      >
        <I.Keyboard size={16} />
      </button>
      <RailButton id="settings" active={nav === "settings"} onNav={onNav} />
      {/* The connected tracker account; opens Integrations (where the connection lives). */}
      <button
        type="button"
        className="me"
        title={user ? user.displayName : "No tracker connected"}
        aria-label={
          user
            ? `${user.displayName}, open Integrations`
            : "No tracker connected, open Integrations"
        }
        onClick={() => onNav("integrations")}
      >
        {/* No account: the Integrations plug, not a "?" that reads as help. */}
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.displayName} />
        ) : (
          (user?.displayName?.trim()[0]?.toUpperCase() ?? <I.Plug size={14} />)
        )}
      </button>
    </aside>
  );
}
