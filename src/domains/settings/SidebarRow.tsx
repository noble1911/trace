import type { DragEvent, KeyboardEvent } from "react";
import { navTracker } from "@/app/nav";
import { RAIL_ICONS } from "@/app/railIcons";
import { I } from "@/components/Icon";
import { Switch } from "@/components/Switch";
import type { ProviderKind } from "@/domains/issues/types";
import {
  type SidebarEntry,
  type SidebarItemDef,
  TRACKER_NAMES,
  type Visibility,
} from "@/domains/sidebar/items";
import { isShortcut, useHint } from "@/platform/shortcuts";

interface SidebarRowProps {
  def: SidebarItemDef;
  entry: SidebarEntry;
  /** Whether the page's tracker is connected (for the status line). */
  connected: boolean;
  canUp: boolean;
  canDown: boolean;
  isDragging: boolean;
  dragProps?: {
    draggable: boolean;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
  };
  onVisibility: (v: Visibility) => void;
  onNudge: (delta: -1 | 1) => void;
  /** How to reach a hidden page ("Search (Ctrl+Shift+K)"). */
  searchHint: string;
}

/** Why a page is or isn't on the rail now — the rule's reason, in one line. */
function status(
  entry: SidebarEntry,
  tracker: ProviderKind | undefined,
  connected: boolean,
  searchHint: string
): string {
  if (entry.visibility === "hidden") return `Hidden. Still opens from ${searchHint}.`;
  if (!tracker) return "";
  const name = TRACKER_NAMES[tracker];
  if (entry.visibility === "shown") {
    return connected ? `Always shown.` : `Shown without ${name}; the page says how to connect it.`;
  }
  return connected ? `Shown while ${name} is connected.` : `Hidden until ${name} is connected.`;
}

// One page in Settings → Sidebar: grip, glyph and name, why it shows or not, its
// show/hide control, and move buttons (sidebarMoveUp/Down on the row do the same).
export function SidebarRow(props: SidebarRowProps) {
  const { def, entry, connected, canUp, canDown, isDragging, dragProps, searchHint } = props;
  const Icon = RAIL_ICONS[def.id];
  const tracker = navTracker(def.id);
  const line = def.isFixed ? def.desc : status(entry, tracker, connected, searchHint);
  const upKey = useHint("sidebarMoveUp");
  const downKey = useHint("sidebarMoveDown");
  const onKeyDown = (e: KeyboardEvent) => {
    if (def.isFixed) return;
    const delta = isShortcut("sidebarMoveUp", e) ? -1 : isShortcut("sidebarMoveDown", e) ? 1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    props.onNudge(delta);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Alt+↑/↓ from any control in the row
    <div
      className={`sb-row${isDragging ? " dragging" : ""}${def.isFixed ? " fixed" : ""}`}
      onKeyDown={onKeyDown}
      {...dragProps}
    >
      <span className="sb-grip" title={def.isFixed ? undefined : "Drag to reorder"}>
        {!def.isFixed && <I.Grip size={14} />}
      </span>
      <span className="sb-icon">
        <Icon size={16} />
      </span>
      <span className="sb-text">
        <span className="label">{def.label}</span>
        <span className="hint">{line || def.desc}</span>
      </span>
      <span className="sb-control">
        {def.isFixed ? (
          <span className="sb-fixed">Always shown</span>
        ) : tracker ? (
          <fieldset className="seg" aria-label={`Show ${def.label}`}>
            {(["auto", "shown", "hidden"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={entry.visibility === v ? "on" : undefined}
                aria-pressed={entry.visibility === v}
                onClick={() => props.onVisibility(v)}
              >
                {v === "auto" ? `With ${TRACKER_NAMES[tracker]}` : v === "shown" ? "Show" : "Hide"}
              </button>
            ))}
          </fieldset>
        ) : (
          <Switch
            on={entry.visibility !== "hidden"}
            onChange={(on) => props.onVisibility(on ? "auto" : "hidden")}
            label={`Show ${def.label}`}
          />
        )}
      </span>
      <span className="sb-move">
        {!def.isFixed && (
          <>
            <button
              type="button"
              className="btn ghost icon"
              aria-label={`Move ${def.label} up`}
              title={`Move up (${upKey})`}
              aria-disabled={!canUp}
              onClick={() => canUp && props.onNudge(-1)}
            >
              <I.Chevron size={13} style={{ transform: "rotate(-90deg)" }} />
            </button>
            <button
              type="button"
              className="btn ghost icon"
              aria-label={`Move ${def.label} down`}
              title={`Move down (${downKey})`}
              aria-disabled={!canDown}
              onClick={() => canDown && props.onNudge(1)}
            >
              <I.Chevron size={13} style={{ transform: "rotate(90deg)" }} />
            </button>
          </>
        )}
      </span>
    </div>
  );
}
