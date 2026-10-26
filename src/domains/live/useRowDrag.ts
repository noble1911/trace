import { type DragEvent, useState } from "react";
import { useLiveStore } from "./store";

/** Where a drop would land: before `before` (null = after the last row). */
interface DropTarget {
  before: string | null;
}

/**
 * Drag-to-reorder for a live-agent list (inbox, fleet). `order` is the full
 * list order — rows hidden by a filter keep their place — and `visible` the
 * rows on screen, so dropping below the last visible row lands just after it.
 */
export function useRowDrag(order: string[], visible: string[]) {
  const move = useLiveStore((s) => s.move);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);

  const afterOf = (id: string): string | null => {
    const i = order.indexOf(id);
    return i >= 0 && i + 1 < order.length ? order[i + 1] : null;
  };

  const rowProps = (id: string) => ({
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
      const upper = e.clientY < box.top + box.height / 2;
      const isLast = visible[visible.length - 1] === id;
      setTarget({ before: upper ? id : isLast ? afterOf(id) : nextVisible(visible, id) });
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging && target) move(order, dragging, target.before);
      setDragging(null);
      setTarget(null);
    },
    onDragEnd: () => {
      setDragging(null);
      setTarget(null);
    },
  });

  /** Whether the drop line sits just above row `id`. */
  const dropAbove = (id: string) => dragging !== null && target?.before === id && dragging !== id;
  /** Whether the drop line sits below the last visible row. */
  const dropAtEnd = () => {
    if (!dragging || !target) return false;
    const last = visible[visible.length - 1];
    return last !== undefined && target.before === afterOf(last) && dragging !== last;
  };

  return { rowProps, dragging, dropAbove, dropAtEnd };
}

function nextVisible(visible: string[], id: string): string | null {
  const i = visible.indexOf(id);
  return i >= 0 && i + 1 < visible.length ? visible[i + 1] : null;
}
