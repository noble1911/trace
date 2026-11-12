import type { DragEvent, JSX, KeyboardEvent, ReactNode } from "react";
import { navTracker } from "@/app/nav";
import { RAIL_ICONS } from "@/app/railIcons";
import { I, type IconProps } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { Segmented } from "@/components/Segmented";
import { Switch } from "@/components/Switch";
import type { ProviderKind } from "@/domains/issues/types";
import {
  type SidebarEntry,
  type SidebarItemDef,
  TRACKER_NAMES,
  type Visibility,
} from "@/domains/sidebar/items";
import { isShortcut } from "@/platform/shortcuts";

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
  /** A row that isn't one page (the grouped boards) brings its own glyph, status line
   * and show/hide control. */
  icon?: (p: IconProps) => JSX.Element;
  line?: string;
  control?: ReactNode;
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
  const Icon = props.icon ?? RAIL_ICONS[def.id];
  const tracker = props.control ? undefined : navTracker(def.id);
  const line =
    props.line ?? (def.isFixed ? def.desc : status(entry, tracker, connected, searchHint));
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
        {props.control ??
          (def.isFixed ? (
            <span className="sb-fixed">Always shown</span>
          ) : tracker ? (
            <Segmented<Visibility>
              label={`Show ${def.label}`}
              value={entry.visibility}
              options={[
                { value: "auto", label: `With ${TRACKER_NAMES[tracker]}` },
                { value: "shown", label: "Show" },
                { value: "hidden", label: "Hide" },
              ]}
              onChange={props.onVisibility}
            />
          ) : (
            <Switch
              on={entry.visibility !== "hidden"}
              onChange={(on) => props.onVisibility(on ? "auto" : "hidden")}
              label={`Show ${def.label}`}
            />
          ))}
      </span>
      <span className="sb-move">
        {!def.isFixed && (
          <>
            <IconButton
              size="sm"
              className="ghost sb-up"
              label={`Move ${def.label} up`}
              shortcut="sidebarMoveUp"
              aria-disabled={!canUp}
              onClick={() => canUp && props.onNudge(-1)}
            >
              <I.Chevron size={14} />
            </IconButton>
            <IconButton
              size="sm"
              className="ghost sb-down"
              label={`Move ${def.label} down`}
              shortcut="sidebarMoveDown"
              aria-disabled={!canDown}
              onClick={() => canDown && props.onNudge(1)}
            >
              <I.Chevron size={14} />
            </IconButton>
          </>
        )}
      </span>
    </div>
  );
}
