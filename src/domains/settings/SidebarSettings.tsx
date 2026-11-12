import { Fragment } from "react";
import { isBoardNav, navTracker } from "@/app/nav";
import { BOARD_GROUP_ICON } from "@/app/railIcons";
import { InlineConfirm } from "@/components/InlineConfirm";
import { Segmented } from "@/components/Segmented";
import { Switch } from "@/components/Switch";
import { useIssuesStore } from "@/domains/issues/store";
import { isGroupShown, sidebarRows } from "@/domains/sidebar/boardGroup";
import { BOARD_GROUP_ITEM, sidebarItem } from "@/domains/sidebar/items";
import { isDefaultSidebar } from "@/domains/sidebar/prefs";
import { RECENTS_DELAYS } from "@/domains/sidebar/recentsDelay";
import { useSidebarStore } from "@/domains/sidebar/store";
import { useHint } from "@/platform/shortcuts";
import { SettingRow } from "./SettingRow";
import { SettingSection } from "./SettingSection";
import { SidebarRow } from "./SidebarRow";
import { useSidebarDrag } from "./useSidebarDrag";

const DELAY_OPTIONS = RECENTS_DELAYS.map((ms) => ({
  value: ms,
  label: ms === 0 ? "Instant" : `${ms / 1000}s`,
}));

// Settings → Layout → Sidebar: every page the rail can show, in the rail's order. Each can be
// hidden or shown, and dragged (or moved with the buttons / Alt+↑↓) into a new place;
// Settings itself stays, at the bottom. Above it, whether the board pages are one
// Boards button (on by default), which makes them one row here too. Changes reach the rail at once. Below the
// list, whether resting on Sessions slides out your recent sessions (off by
// default), and how long it waits first (inactive while it's off, never unmounted).
export function SidebarSettings() {
  const entries = useSidebarStore((s) => s.entries);
  const setVisibility = useSidebarStore((s) => s.setVisibility);
  const nudge = useSidebarStore((s) => s.nudge);
  const reset = useSidebarStore((s) => s.reset);
  const recentsFlyout = useSidebarStore((s) => s.recentsFlyout);
  const setRecentsFlyout = useSidebarStore((s) => s.setRecentsFlyout);
  const recentsDelay = useSidebarStore((s) => s.recentsDelay);
  const setRecentsDelay = useSidebarStore((s) => s.setRecentsDelay);
  const groupBoards = useSidebarStore((s) => s.groupBoards);
  const setGroupBoards = useSidebarStore((s) => s.setGroupBoards);
  const setGroupVisible = useSidebarStore((s) => s.setGroupVisible);
  const trackers = useIssuesStore((s) => s.sessions);
  const searchKey = useHint("search");
  // A row per page, or grouped, the board pages as one row named by its first page's id.
  const rows = sidebarRows(entries, groupBoards);
  const movable = rows.filter((r) => !sidebarItem(r[0].id)?.isFixed).map((r) => r[0].id);
  const groupShown = isGroupShown(entries, trackers);
  const drag = useSidebarDrag(movable);
  const isDefault = isDefaultSidebar(entries);

  return (
    <SettingSection
      title="Sidebar"
      desc={`The pages in the rail on the left, top to bottom. Drag a row, or use its arrows, to reorder. A hidden page still opens from search (${searchKey}).`}
      actions={
        <InlineConfirm
          label="Reset to default"
          disabled={isDefault}
          title={isDefault ? "The sidebar is in its built-in order" : undefined}
          message="Put every page back in its built-in place and visibility?"
          confirmLabel="Reset"
          onConfirm={reset}
        />
      }
    >
      {/* Above the list it reshapes, so turning it on or off doesn't move it. */}
      <SettingRow
        label="Group boards under one button"
        hint="One Boards button on the rail for every board. While a board is open, your boards are listed beneath it."
      >
        <Switch on={groupBoards} onChange={setGroupBoards} label="Group boards under one button" />
      </SettingRow>
      <div className="sb-list">
        {rows.map(([entry]) => {
          const page = sidebarItem(entry.id);
          if (!page) return null;
          const isGroup = groupBoards && isBoardNav(entry.id);
          const def = isGroup ? { ...page, ...BOARD_GROUP_ITEM } : page;
          const tracker = navTracker(entry.id);
          const i = movable.indexOf(entry.id);
          return (
            <Fragment key={entry.id}>
              {drag.dropAt(entry.id) && <div className="sb-drop" aria-hidden="true" />}
              {def.isFixed && drag.dropAt(null) && <div className="sb-drop" aria-hidden="true" />}
              <SidebarRow
                def={def}
                entry={entry}
                connected={!tracker || Boolean(trackers[tracker])}
                canUp={i > 0}
                canDown={i !== -1 && i < movable.length - 1}
                isDragging={drag.dragging === entry.id}
                dragProps={def.isFixed ? undefined : drag.rowProps(entry.id)}
                onVisibility={(v) => setVisibility(entry.id, v)}
                onNudge={(d) => nudge(entry.id, d)}
                searchHint={`search (${searchKey})`}
                {...(isGroup && {
                  icon: BOARD_GROUP_ICON,
                  line: groupShown ? def.desc : `Hidden. Still opens from search (${searchKey}).`,
                  control: (
                    <Switch on={groupShown} onChange={setGroupVisible} label="Show Boards" />
                  ),
                })}
              />
            </Fragment>
          );
        })}
      </div>
      <SettingRow
        label="Recent sessions"
        hint="Resting the pointer on Sessions, while it's open, slides out the sessions you last opened."
      >
        <Switch on={recentsFlyout} onChange={setRecentsFlyout} label="Show recent sessions" />
      </SettingRow>
      <SettingRow
        label="Recent sessions delay"
        hint="How long the pointer rests on Sessions before your recent sessions slide out."
        inactive={!recentsFlyout}
        inactiveReason="Applies when Recent sessions is on."
      >
        <Segmented
          label="Recent sessions delay"
          value={recentsDelay}
          options={DELAY_OPTIONS}
          onChange={setRecentsDelay}
        />
      </SettingRow>
    </SettingSection>
  );
}
