import type { ReactNode } from "react";
import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { MoreTrigger, PopMenu } from "@/components/PopMenu";
import { Segmented } from "@/components/Segmented";
import type { GalleryImage } from "@/ipc/gallery";
import { imageMenu } from "./imageActions";
import { formatSize } from "./model";

export interface Compare {
  mode: "side" | "swipe";
  /** The second image's index in the set. */
  other: number;
}

interface ViewerBarProps {
  workspaceId: string;
  setId: string;
  img: GalleryImage;
  other: GalleryImage | undefined;
  index: number;
  count: number;
  /** The image's scale as drawn. */
  scale: number;
  fit: boolean;
  compare: Compare | null;
  onFit: () => void;
  onActual: () => void;
  onCompare: (mode: Compare["mode"] | null) => void;
  /** Step to the previous (-1) or next (1) image in the set, wrapping around. */
  onStep: (step: -1 | 1) => void;
  onClose: () => void;
}

type Mode = "single" | Compare["mode"];

const MODES: { value: Mode; label: ReactNode; name: string }[] = [
  { value: "single", label: <I.Square size={14} />, name: "One image" },
  { value: "side", label: <I.Compare size={14} />, name: "Side by side" },
  { value: "swipe", label: <I.MoveHorizontal size={14} />, name: "Swipe" },
];

// The viewer's header: previous / next, which image (and against which), Fit / 1:1
// and the zoom, the comparison mode, the image's actions, and close.
export function ViewerBar(p: ViewerBarProps) {
  const zoom = p.fit ? "Fit" : `${Math.round(p.scale * 100)}%`;
  return (
    <div className="gv-bar">
      {p.count > 1 && (
        <div className="gv-nav">
          <IconButton
            size="sm"
            className="gv-prev"
            label="Previous image"
            onClick={() => p.onStep(-1)}
          >
            <I.Chevron size={14} />
          </IconButton>
          <IconButton size="sm" label="Next image" onClick={() => p.onStep(1)}>
            <I.Chevron size={14} />
          </IconButton>
        </div>
      )}
      <div className="gv-what">
        <span className="gv-name" title={p.img.path}>
          {p.img.name}
          {p.other && <span className="gv-vs"> vs {p.other.name}</span>}
        </span>
        <span className="gv-meta">
          {p.index + 1} / {p.count} · {formatSize(p.img.size)} ·{" "}
          <span className="gv-zoom">{p.fit ? `Fit (${Math.round(p.scale * 100)}%)` : zoom}</span>
        </span>
      </div>
      <div className="gv-actions">
        <Segmented
          label="Compare"
          className="gv-modes"
          value={p.compare?.mode ?? "single"}
          options={p.count > 1 ? MODES : MODES.slice(0, 1)}
          onChange={(m) => p.onCompare(m === "single" ? null : m)}
        />
        <Segmented
          label="Zoom"
          value={p.fit ? "fit" : p.scale === 1 ? "actual" : "custom"}
          options={[
            { value: "fit", label: "Fit" },
            { value: "actual", label: "1:1" },
          ]}
          onChange={(v) => (v === "fit" ? p.onFit() : p.onActual())}
        />
        <PopMenu
          trigger={({ open, toggle }) => (
            <MoreTrigger open={open} toggle={toggle} label="Image actions" size="sm" />
          )}
          sections={imageMenu(p.workspaceId, p.setId, p.img)}
        />
        {/* Esc closes it (ImageViewer), as it backs out of a detail: `detailBack`'s key. */}
        <IconButton size="sm" label="Close viewer" shortcut="detailBack" onClick={p.onClose}>
          <I.X size={14} />
        </IconButton>
      </div>
    </div>
  );
}
