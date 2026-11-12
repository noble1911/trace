import type { JSX } from "react";
import { boardNav } from "@/app/nav";
import { RAIL_ICONS } from "@/app/railIcons";
import { I, type IconProps } from "@/components/Icon";
import type { BoardOption, ProviderKind } from "@/domains/issues/types";
import { useBoardIcons } from "./boardIcons";

/** A tracker's own glyph: the one its page has on the rail. */
export function trackerGlyph(provider: ProviderKind): (p: IconProps) => JSX.Element {
  return RAIL_ICONS[boardNav(provider)];
}

interface BoardGlyphProps {
  board: Pick<BoardOption, "key" | "provider">;
  size: 12 | 14 | 16;
}

// A board's glyph wherever it's drawn (the rail's Boards group, the topbar's switcher,
// the board's header): the icon chosen in its settings (custom boards), else its type's.
export function BoardGlyph({ board, size }: BoardGlyphProps) {
  const chosen = useBoardIcons((s) =>
    board.provider === "custom" ? s.icons[board.key] : undefined
  );
  const Glyph = chosen ? I[chosen] : trackerGlyph(board.provider);
  return <Glyph size={size} />;
}
