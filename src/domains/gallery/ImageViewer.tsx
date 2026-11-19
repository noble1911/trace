import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type GalleryImage, imageSrc } from "@/ipc/gallery";
import { stepIndex } from "./model";
import { type Compare, ViewerBar } from "./ViewerBar";
import { FIT, MAX_SCALE, MIN_SCALE, ZoomStage, type ZoomView } from "./ZoomStage";

interface ImageViewerProps {
  workspaceId: string;
  setId: string;
  images: GalleryImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

// One image full size, over the set's grid: ←/→ step through the set, wheel or
// pinch zooms, dragging pans, 0 fits, 1 is 1:1, +/- zoom, Esc closes. Compare puts a
// second image beside it, or under a swipe slider (Shift+←/→ steps that one); both
// zoom and pan together.
export function ImageViewer(p: ImageViewerProps) {
  const { images, index } = p;
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ZoomView>(FIT);
  const [scale, setScale] = useState(1);
  const [compare, setCompare] = useState<Compare | null>(null);
  const [split, setSplit] = useState(50);
  const img = images[index];
  const other = compare ? images[compare.other] : undefined;

  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new image starts fitted
  useEffect(() => setView(FIT), [img?.path, compare?.mode]);
  if (!img) return null;
  const src = (i: GalleryImage) => imageSrc(p.workspaceId, p.setId, i);

  const zoomBy = (k: number) => {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * k));
    setView({
      fit: false,
      scale: s,
      x: view.fit ? 0 : view.x * (s / scale),
      y: view.fit ? 0 : view.y * (s / scale),
    });
  };
  const startCompare = (mode: Compare["mode"]) =>
    setCompare((c) => ({ mode, other: c?.other ?? stepIndex(index, 1, images.length) }));
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step && e.shiftKey && compare) {
      setCompare({ ...compare, other: stepIndex(compare.other, step, images.length) });
    } else if (step) {
      p.onIndex(stepIndex(index, step, images.length));
    } else if (e.key === "Escape") {
      if (compare) setCompare(null);
      else p.onClose();
    } else if (e.key === "0") setView(FIT);
    else if (e.key === "1") setView({ fit: false, scale: 1, x: 0, y: 0 });
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <section
      ref={ref}
      className="gv"
      aria-label={`Image viewer: ${img.name}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <ViewerBar
        workspaceId={p.workspaceId}
        setId={p.setId}
        img={img}
        other={other}
        index={index}
        count={images.length}
        scale={scale}
        fit={view.fit}
        compare={compare}
        onFit={() => setView(FIT)}
        onActual={() => setView({ fit: false, scale: 1, x: 0, y: 0 })}
        onCompare={(mode) => (mode ? startCompare(mode) : setCompare(null))}
        onStep={(step) => p.onIndex(stepIndex(index, step, images.length))}
        onClose={p.onClose}
      />
      {compare?.mode === "side" && other ? (
        <div className="gv-side">
          <ZoomStage
            layers={[{ src: src(img), alt: img.name }]}
            view={view}
            onView={setView}
            onScale={setScale}
          />
          <ZoomStage layers={[{ src: src(other), alt: other.name }]} view={view} onView={setView} />
        </div>
      ) : compare?.mode === "swipe" && other ? (
        <>
          <ZoomStage
            layers={[
              { src: src(img), alt: img.name },
              { src: src(other), alt: other.name, clipLeft: split },
            ]}
            view={view}
            onView={setView}
            onScale={setScale}
          />
          <div className="gv-swipe">
            <span className="gv-swipe-name">{img.name}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              aria-label="Where the second image starts"
              onChange={(e) => setSplit(Number(e.target.value))}
            />
            <span className="gv-swipe-name">{other.name}</span>
          </div>
        </>
      ) : (
        <ZoomStage
          layers={[{ src: src(img), alt: img.name }]}
          view={view}
          onView={setView}
          onScale={setScale}
        />
      )}
    </section>
  );
}
