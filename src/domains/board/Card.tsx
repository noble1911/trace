import { openUrl } from "@tauri-apps/plugin-opener";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { I } from "@/components/Icon";
import { RowMenuPopover, RowMore } from "@/components/RowMenu";
import { StatusLight } from "@/components/StatusLight";
import { findAction, useRowMenu } from "@/components/useRowMenu";
import { epicColor } from "@/domains/board/epicColor";
import { useBoardStore } from "@/domains/board/store";
import { CardDeletePrompt } from "@/domains/boards/CardDeletePrompt";
import { useBoardsUi } from "@/domains/boards/uiStore";
import { useIssuesStore } from "@/domains/issues/store";
import type { Issue, PullRequest } from "@/domains/issues/types";
import { jiraBrowseUrl } from "@/domains/issues/url";
import { ageLabel, shownAsk } from "@/domains/live/light";
import { useAgentQuiet } from "@/domains/live/quietStore";
import { useLiveStore } from "@/domains/live/store";
import { useNow } from "@/hooks/useNow";
import { cardMenu, START_ACTION } from "./cardMenu";
import { useDensity } from "./density";

interface CardProps {
  issue: Issue;
  prs?: PullRequest[];
  onOpen: (key: string) => void;
  onDragStart: (e: DragEvent, key: string) => void;
}

function prStateClass(state: string): string {
  // Reuse the design's pr-pill variants: open/draft/merged. Declined falls back.
  if (state === "open" || state === "draft" || state === "merged") return state;
  return "draft";
}

// The card outer is a `div role="button"` (rather than a real `<button>`) so we can
// nest a real `<button>` for the PR pill without breaking HTML's no-nested-interactives rule.
// Its actions are one list (`cardMenu`), behind the ⋯ that shows on hover or focus and
// behind right-click (or the context-menu key); Start stays a visible button.
export function Card({ issue, prs, onOpen, onDragStart }: CardProps) {
  const firstPr = prs && prs.length > 0 ? prs[0] : null;
  const live = useLiveStore((s) => s.info[issue.key]);
  const light = live?.light ?? "stopped";
  const quiet = useAgentQuiet(issue.key);
  const density = useDensity((s) => s.density);
  // Ages tick while an agent runs; an idle card has none to keep fresh.
  const now = useNow(live ? 30_000 : null);
  const kickoff = useBoardStore((s) => s.kickoff);
  // Epic links are Jira-only (Pylon issues carry no epic).
  const site = useIssuesStore((s) => s.sessions.jira?.site ?? null);
  const epicUrl = issue.epicKey ? jiraBrowseUrl(site, issue.epicKey) : undefined;

  // A custom board's card (trace's own) is edited and deleted from here too.
  const isCustom = useBoardStore((s) => s.provider === "custom");
  const deleting = useBoardsUi((s) => s.deletingCard === issue.key);
  const canStart = !live && issue.statusCategory !== "done";
  const menu = useRowMenu();

  const open = () => onOpen(issue.key);
  const onCardKey = (e: KeyboardEvent) => {
    // Enter on a button in the card (Start, the ⋯, a pill) is that button's.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") open();
  };
  const actions = cardMenu({
    issueKey: issue.key,
    onStart: canStart ? () => kickoff(issue.key) : undefined,
    hasAgent: Boolean(live),
    pr: firstPr,
    epic: epicUrl && issue.epicKey ? { key: issue.epicKey, url: epicUrl } : undefined,
    onOpen: open,
    custom: isCustom
      ? {
          onEdit: () => useBoardsUi.getState().editCard(issue.key),
          onDelete: () => useBoardsUi.getState().confirmDeleteCard(issue.key),
        }
      : undefined,
  });
  const start = findAction(actions, START_ACTION);

  const onPrClick = (e: MouseEvent) => {
    if (!firstPr) return;
    e.stopPropagation();
    void openUrl(firstPr.url);
  };

  const onEpicClick = (e: MouseEvent) => {
    if (!epicUrl) return;
    e.stopPropagation();
    void openUrl(epicUrl);
  };

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: needs to host a nested <button> for the PR pill (HTML forbids nested interactives) — keyboard activation handled */}
      <div
        className={`card light-${light} density-${density}`}
        draggable
        role="button"
        tabIndex={0}
        onDragStart={(e) => onDragStart(e, issue.key)}
        onClick={open}
        onKeyDown={onCardKey}
        onContextMenu={menu.onContextMenu}
      >
        <div className="row">
          <span className={`priority ${issue.priority}`} />
          <span className="ticket-id">{issue.key}</span>
          <span className="card-end">
            {live ? (
              <StatusLight
                light={light}
                quiet={quiet}
                variant="pill"
                label={shownAsk(live)?.label}
                age={ageLabel(live.since, now * 1000)}
              />
            ) : (
              start && (
                <button
                  type="button"
                  className="btn xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    start.onSelect();
                  }}
                  title={start.title}
                >
                  <I.Play size={12} /> Start
                </button>
              )
            )}
            <AgentAvatar assignee={issue.assignee} />
            <RowMore menu={menu} label="Ticket actions" className="card-more" />
          </span>
        </div>

        {issue.epic && density !== "compact" && (
          <div className="epic-line">
            {epicUrl ? (
              <button
                type="button"
                className="epic-chip"
                style={{ color: epicColor(issue.epicKey, issue.epicColor) }}
                onClick={onEpicClick}
                title={`${issue.epicKey ?? ""} · ${issue.epic} — opens in Jira`}
              >
                <I.Layers size={12} />
                <span className="epic-name">{issue.epic}</span>
              </button>
            ) : (
              <span
                className="epic-chip"
                style={{ color: epicColor(issue.epicKey, issue.epicColor) }}
                title={issue.epic}
              >
                <I.Layers size={12} />
                <span className="epic-name">{issue.epic}</span>
              </span>
            )}
          </div>
        )}

        <div className="title">{issue.summary}</div>

        {live?.lastMessage && density !== "compact" && (
          <div className="card-quote" title={live.lastMessage}>
            {live.lastMessage}
          </div>
        )}

        {density !== "compact" && (
          <div className="meta">
            <span className="card-type">
              <I.Ticket size={12} /> {issue.issueType}
            </span>
            {issue.labels.slice(0, 2).map((label) => (
              <span key={label} className="card-label">
                <span className="dot-sep">·</span>
                {label}
              </span>
            ))}
            {firstPr && (
              <button
                type="button"
                className={`pr-pill card-pr ${prStateClass(firstPr.state)}`}
                onClick={onPrClick}
                title={`${firstPr.title || `PR #${firstPr.number}`} — opens on GitHub`}
              >
                <I.GitPR size={12} /> #{firstPr.number}
              </button>
            )}
          </div>
        )}
        {deleting && <CardDeletePrompt issueKey={issue.key} />}
      </div>
      <RowMenuPopover menu={menu} sections={actions} />
    </>
  );
}
