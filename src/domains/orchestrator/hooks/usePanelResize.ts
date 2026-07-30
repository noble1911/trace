import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampPanelSize,
  DEFAULT_PANEL_SIZE,
  loadPanelSize,
  type PanelSize,
  savePanelSize,
} from "../panelSize";

/** Which edge of the panel is being dragged. */
export type ResizeEdge = "left" | "top" | "corner";

/** How much one arrow-key press moves an edge. */
const KEY_STEP = 24;

function stepFor(key: string, grow: string, shrink: string): number {
  if (key === grow) return KEY_STEP;
  if (key === shrink) return -KEY_STEP;
  return 0;
}

/**
 * Drag-to-resize for the orchestrator panel. The panel is pinned to the
 * bottom-right corner, so its grabbable edges are the left one, the top one, and
 * the corner between them: dragging left/up grows the panel, which keeps the
 * anchored corner still instead of sliding the whole panel across the screen.
 *
 * Pointer capture means the drag survives the cursor leaving the 6px handle (and
 * crossing the chat transcript or a chart iframe), so there's no window-level
 * listener to leak.
 */
export function usePanelResize() {
  const [size, setSize] = useState<PanelSize>(() => clampPanelSize(loadPanelSize()));
  const [resizing, setResizing] = useState(false);
  // Mirrors `size` for the drag/save paths, which need the latest value without
  // re-creating the pointer handlers on every mousemove-driven render.
  const sizeRef = useRef(size);

  const apply = useCallback((next: PanelSize) => {
    sizeRef.current = next;
    setSize(next);
  }, []);

  // A window that shrank below the stored size would leave the panel hanging off
  // the viewport (or under the rail) — re-fit instead.
  useEffect(() => {
    const onWindowResize = () => apply(clampPanelSize(sizeRef.current));
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [apply]);

  const startResize = useCallback(
    (edge: ResizeEdge) => (e: React.PointerEvent<HTMLElement>) => {
      // Left button only, and don't let the gesture start a text selection.
      if (e.button !== 0) return;
      e.preventDefault();
      const handle = e.currentTarget;
      const startX = e.clientX;
      const startY = e.clientY;
      const start = sizeRef.current;
      handle.setPointerCapture(e.pointerId);
      setResizing(true);

      const onMove = (ev: PointerEvent) => {
        apply(
          clampPanelSize({
            width: edge === "top" ? start.width : start.width - (ev.clientX - startX),
            height: edge === "left" ? start.height : start.height - (ev.clientY - startY),
          })
        );
      };
      const onEnd = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onEnd);
        handle.removeEventListener("pointercancel", onEnd);
        setResizing(false);
        savePanelSize(sizeRef.current);
      };
      // Captured pointer events retarget to the handle, so these cover the whole
      // drag wherever the cursor goes.
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onEnd);
      handle.addEventListener("pointercancel", onEnd);
    },
    [apply]
  );

  /** Keyboard equivalent of a drag, for a focused handle. Same direction sense:
   *  left/up grow the panel, since it's anchored to the bottom-right. */
  const onHandleKey = useCallback(
    (edge: ResizeEdge) => (e: React.KeyboardEvent<HTMLElement>) => {
      const dw = edge === "top" ? 0 : stepFor(e.key, "ArrowLeft", "ArrowRight");
      const dh = edge === "left" ? 0 : stepFor(e.key, "ArrowUp", "ArrowDown");
      if (dw === 0 && dh === 0) return;
      e.preventDefault();
      const next = clampPanelSize({
        width: sizeRef.current.width + dw,
        height: sizeRef.current.height + dh,
      });
      apply(next);
      savePanelSize(next);
    },
    [apply]
  );

  const resetSize = useCallback(() => {
    const next = clampPanelSize(DEFAULT_PANEL_SIZE);
    apply(next);
    savePanelSize(next);
  }, [apply]);

  return { size, resizing, startResize, onHandleKey, resetSize };
}
