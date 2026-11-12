import type { DragEvent } from "react";
import { I } from "@/components/Icon";
import { RowMenuPopover, RowMore } from "@/components/RowMenu";
import { StatusLight } from "@/components/StatusLight";
import { useRowMenu } from "@/components/useRowMenu";
import { trackerForIssueKey } from "@/domains/issues/types";
import type { LiveEntry } from "@/domains/live/entries";
import { ageLabel, shownAsk } from "@/domains/live/light";
import { useAgentQuiet } from "@/domains/live/quietStore";
import { TRACKER_NAMES } from "@/domains/sidebar/items";
import { useAgentRowActions } from "./agentRowActions";

/** A PR as the fleet shows it — from Jira dev-status (tickets) or `gh` (sessions). */
export interface FleetPr {
  number: number | string;
  state: string;
  url: string;
}

interface FleetRowProps {
  entry: LiveEntry;
  now: number;
  where: string | null;
  diff: { add: number; del: number } | undefined;
  pr: FleetPr | null;
  dropAbove: boolean;
  isDragging: boolean;
  dragProps: {
    draggable: boolean;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
  };
  onOpen: () => void;
  onOpenPr: (url: string) => void;
}

const SOURCE_LABEL = { session: "Session", scheduled: "Scheduled" } as const;

/** Where it came from: a ticket names its tracker ("Jira ticket", "Pylon ticket"). */
function sourceLabel(entry: LiveEntry): string {
  if (entry.source !== "ticket") return SOURCE_LABEL[entry.source];
  return `${TRACKER_NAMES[trackerForIssueKey(entry.id)]} ticket`;
}

const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// One live agent as a table row. Rows keep their place when state changes;
// the grip drags them, the row opens the agent. Its ⋯ (on hover or focus) and its
// right-click list what can be done with it (`useAgentRowActions`).
export function FleetRow(props: FleetRowProps) {
  const { entry, now, where, diff, pr, dropAbove, isDragging, dragProps } = props;
  const { info } = entry;
  const quiet = useAgentQuiet(entry.id);
  const ask = shownAsk(info);
  const latest = ask?.label ?? info.update ?? info.lastMessage ?? "";
  const menu = useRowMenu();
  const actions = useAgentRowActions({ entry, onOpen: props.onOpen, pr });
  return (
    <>
      {dropAbove && <div className="fl-drop" aria-hidden="true" />}
      {/* biome-ignore lint/a11y/useSemanticElements: hosts a nested PR button; HTML forbids nested interactives */}
      <div
        className={`fl-row${info.light === "attention" ? " needs" : ""}${isDragging ? " dragging" : ""}${menu.at ? " menu-open" : ""}`}
        role="button"
        tabIndex={0}
        onClick={props.onOpen}
        onKeyDown={(e) => {
          // Enter on the PR pill or the ⋯ is that button's.
          if (e.target === e.currentTarget && e.key === "Enter") props.onOpen();
        }}
        onContextMenu={menu.onContextMenu}
        {...dragProps}
      >
        <span className="fl-grip" title="Drag to reorder">
          <I.Grip size={14} />
        </span>
        <StatusLight light={info.light} quiet={quiet} variant="word" />
        <span className="fl-agent">
          <span className="fl-title">{entry.title}</span>
          <span className="fl-sub">{entry.subtitle}</span>
        </span>
        <span className="fl-src">{sourceLabel(entry)}</span>
        <span className="mono">{clock(info.openedAt)}</span>
        <span className={`mono${info.light === "attention" ? " hot" : ""}`}>
          {ageLabel(info.since, now)}
        </span>
        <span className="mono fl-ell" title={where ?? undefined}>
          {where ?? "—"}
        </span>
        <span className="mono">
          {diff && (diff.add > 0 || diff.del > 0) ? (
            <>
              <span className="add">+{diff.add}</span> <span className="del">−{diff.del}</span>
            </>
          ) : (
            "—"
          )}
        </span>
        <span>
          {pr ? (
            <button
              type="button"
              className={`pr-pill ${pr.state}`}
              onClick={(e) => {
                e.stopPropagation();
                props.onOpenPr(pr.url);
              }}
              title="Open on GitHub"
            >
              #{pr.number} {pr.state}
            </button>
          ) : (
            "—"
          )}
        </span>
        <span className="fl-ell fl-latest" title={latest || undefined}>
          {latest}
        </span>
        <RowMore menu={menu} label="Agent actions" className="fl-more" />
      </div>
      <RowMenuPopover menu={menu} sections={actions} />
    </>
  );
}
