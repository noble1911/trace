import { Fragment } from "react";
import { navTracker } from "@/app/nav";
import { useIssuesStore } from "@/domains/issues/store";
import { sidebarItem } from "@/domains/sidebar/items";
import { isDefaultSidebar } from "@/domains/sidebar/prefs";
import { useSidebarStore } from "@/domains/sidebar/store";
import { useHint } from "@/platform/shortcuts";
import { SidebarRow } from "./SidebarRow";
import { useSidebarDrag } from "./useSidebarDrag";

// Settings → Sidebar: every page the rail can show, in the rail's order. Each can be
// hidden or shown, and dragged (or moved with the buttons / Alt+↑↓) into a new place;
// Settings itself stays, at the bottom. Changes reach the rail at once.
export function SidebarSettings() {
  const entries = useSidebarStore((s) => s.entries);
  const setVisibility = useSidebarStore((s) => s.setVisibility);
  const nudge = useSidebarStore((s) => s.nudge);
  const reset = useSidebarStore((s) => s.reset);
  const trackers = useIssuesStore((s) => s.sessions);
  const searchKey = useHint("search");
  const movable = entries.filter((e) => !sidebarItem(e.id)?.isFixed).map((e) => e.id);
  const drag = useSidebarDrag(movable);
  const isDefault = isDefaultSidebar(entries);

  return (
    <section className="setting-group">
      <div className="sc-head">
        <h2>Sidebar</h2>
        <button
          type="button"
          className="btn"
          disabled={isDefault}
          onClick={reset}
          title={isDefault ? "The sidebar is in its built-in order" : undefined}
        >
          Reset to default
        </button>
      </div>
      <div className="desc">
        The pages in the rail on the left, top to bottom. Drag a row, or use its arrows, to reorder.
        A hidden page still opens from search ({searchKey}).
      </div>
      <div className="sb-list">
        {entries.map((entry) => {
          const def = sidebarItem(entry.id);
          if (!def) return null;
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
              />
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
