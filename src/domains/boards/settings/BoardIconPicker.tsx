import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { trackerGlyph } from "../BoardGlyph";
import { BOARD_ICON_CHOICES, BOARD_ICON_NAMES, useBoardIcons } from "../boardIcons";

// Board settings → Icon (custom boards): the glyph the board shows in the rail's Boards
// group, the topbar's switcher and its header. "Default" is the custom-board glyph. A
// pick applies at once, like the card types beside it.
export function BoardIconPicker({ boardKey }: { boardKey: string }) {
  const chosen = useBoardIcons((s) => s.icons[boardKey] ?? null);
  const setIcon = useBoardIcons((s) => s.setIcon);
  const Default = trackerGlyph("custom");
  return (
    <fieldset className="bd-icon-grid" aria-label="Icon">
      <IconButton
        size="sm"
        label="Default"
        aria-pressed={chosen === null}
        onClick={() => setIcon(boardKey, null)}
      >
        <Default size={14} />
      </IconButton>
      {BOARD_ICON_CHOICES.map((id) => {
        const Glyph = I[id];
        return (
          <IconButton
            key={id}
            size="sm"
            label={BOARD_ICON_NAMES[id]}
            aria-pressed={chosen === id}
            onClick={() => setIcon(boardKey, id)}
          >
            <Glyph size={14} />
          </IconButton>
        );
      })}
    </fieldset>
  );
}
