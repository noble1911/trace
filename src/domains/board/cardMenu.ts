import { openUrl } from "@tauri-apps/plugin-opener";
import { I } from "@/components/Icon";
import type { RowAction, RowActionSection } from "@/components/useRowMenu";
import { editorItems } from "@/domains/agent/editorItems";
import type { PullRequest } from "@/domains/issues/types";

interface CardMenuArgs {
  issueKey: string;
  /** Set when the card offers Start (no agent yet, not done). */
  onStart?: () => void;
  /** It has an agent, so a worktree to open in an editor. */
  hasAgent: boolean;
  pr: PullRequest | null;
  /** The epic's page in the tracker, when it has one. */
  epic?: { key: string; url: string };
  onOpen: () => void;
  /** Set on a custom board's card (trace's own), which can be edited and deleted here. */
  custom?: CustomCardActions;
}

/** A custom card's own items. Deleting is refused while its agent runs. */
export interface CustomCardActions {
  onEdit: () => void;
  onDelete: () => void;
}

/** The card's Start, by id: the card draws it as its always-visible `Start` button. */
export const START_ACTION = "start";

/**
 * Everything a board card offers, as one list: its ⋯ and its right-click menu show
 * it all. Open, Start (also the card's own button), its PR and epic (also its pills),
 * and, once it has an agent, the worktree's "Open in …" editors, the same items as
 * the ticket detail's ⋯ (`editorItems`).
 */
export function cardMenu({
  issueKey,
  onStart,
  hasAgent,
  pr,
  epic,
  onOpen,
  custom,
}: CardMenuArgs): RowActionSection[] {
  const main: RowAction[] = [{ id: "open", label: "Open", onSelect: onOpen }];
  if (onStart)
    main.push({
      id: START_ACTION,
      label: "Start agent",
      glyph: I.Play,
      title: `Start an agent on ${issueKey} with the ticket brief`,
      onSelect: onStart,
    });
  const links: RowAction[] = [];
  if (pr)
    links.push({
      id: "pr",
      label: `Open PR #${pr.number} on GitHub`,
      glyph: I.External,
      onSelect: () => void openUrl(pr.url),
    });
  if (epic)
    links.push({
      id: "epic",
      label: `Open epic ${epic.key} in Jira`,
      glyph: I.External,
      onSelect: () => void openUrl(epic.url),
    });
  const card: RowAction[] = custom
    ? [
        { id: "edit", label: "Edit card…", glyph: I.Pencil, onSelect: custom.onEdit },
        {
          id: "delete",
          label: "Delete card",
          glyph: I.Trash,
          danger: true,
          disabled: hasAgent,
          detail: hasAgent ? "Stop its agent first" : undefined,
          onSelect: custom.onDelete,
        },
      ]
    : [];
  return [
    { items: main },
    { items: links },
    { items: card },
    { title: "Worktree", items: hasAgent ? editorItems(issueKey) : [] },
  ];
}
