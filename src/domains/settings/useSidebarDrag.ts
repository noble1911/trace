import { type DragEvent, useState } from "react";
import type { NavId } from "@/app/nav";
import { useSidebarStore } from "@/domains/sidebar/store";

/**
 * Drag-to-reorder for Settings → Sidebar. `movable` is the list in order, fixed
 * items left out; a drop lands before the row under the pointer's upper half, or
 * after it from the lower half (null = after the last).
 */
export function useSidebarDrag(movable: NavId[]) {
  const move = useSidebarStore((s) => s.move);
  const [dragging, setDragging] = useState<NavId | null>(null);
  const [before, setBefore] = useState<NavId | null | undefined>(undefined);

  const end = () => {
    setDragging(null);
    setBefore(undefined);
  };

  const rowProps = (id: NavId) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      setDragging(id);
      e.dataTransfer.effectAllowed = "move";
      // WKWebView won't start a drag session without data (see board/Board.tsx).
      e.dataTransfer.setData("text/plain", id);
    },
    onDragOver: (e: DragEvent) => {
      if (!dragging) return;
      e.preventDefault();
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const i = movable.indexOf(id);
      const upper = e.clientY < box.top + box.height / 2;
      setBefore(upper ? id : (movable[i + 1] ?? null));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging && before !== undefined) move(dragging, before);
      end();
    },
    onDragEnd: end,
  });

  /** Whether the drop line shows just above `id` (null = below the last row). */
  const dropAt = (id: NavId | null) => {
    if (!dragging || before === undefined || before !== id) return false;
    // Dropping a row next to itself changes nothing, so draw no line there.
    const i = movable.indexOf(dragging);
    return id !== dragging && id !== (movable[i + 1] ?? null);
  };

  return { rowProps, dragging, dropAt };
}
