import { I } from "@/components/Icon";
import { type MenuSection, PopMenu } from "@/components/PopMenu";
import type { BoardOption, ProviderKind } from "@/domains/issues/types";
import { BoardGlyph } from "./BoardGlyph";

/** The menu's sections, one per tracker, in the rail's order. */
const SECTIONS: { provider: ProviderKind; title: string }[] = [
  { provider: "jira", title: "Jira" },
  { provider: "pylon", title: "Pylon" },
  { provider: "custom", title: "Your boards" },
];

interface RailBoardsMoreProps {
  boards: BoardOption[];
  selectedKey: string | null;
  onOpen: (board: BoardOption) => void;
  onNew: () => void;
}

// The Boards group's last button when it has more boards than it shows: every board,
// by tracker, with its full name and glyph; picking one opens it. Ends with New board….
export function RailBoardsMore({ boards, selectedKey, onOpen, onNew }: RailBoardsMoreProps) {
  const sections: MenuSection[] = SECTIONS.map(({ provider, title }) => ({
    title,
    items: boards
      .filter((b) => b.provider === provider)
      .map((b) => ({
        id: b.key,
        label: (
          <span className="rb-menu-label">
            <BoardGlyph board={b} size={14} />
            <span className="rb-menu-name">{b.name}</span>
          </span>
        ),
        checked: b.key === selectedKey,
        onSelect: () => onOpen(b),
      })),
  })).filter((s) => s.items.length > 0);
  sections.push({ items: [{ id: "new", label: "New board…", onSelect: onNew }] });

  return (
    <PopMenu
      align="left"
      sections={sections}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className="rb-btn rb-more"
          title="All boards"
          aria-label="All boards"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        >
          <I.More size={14} />
        </button>
      )}
    />
  );
}
