import { useEffect, useState } from "react";
import type { LoadedSprite } from "./characters";
import { type AnimationName, DISPLAY_PX } from "./spriteContract";

interface SpriteProps {
  sprite: LoadedSprite;
  animation: AnimationName;
  label: string;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// One animated character from its sheet: steps through the animation's frames
// at its fps by shifting the background. 128px frames drawn at 64pt are 1:1 on
// Retina; a 1× display gets a smooth half-size downscale.
export function Sprite({ sprite, animation, label }: SpriteProps) {
  const { manifest, sheetUrl } = sprite;
  const anim = manifest.animations[animation] ?? manifest.animations.idle;
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
    if (anim.frames.length < 2 || reducedMotion()) return;
    const timer = window.setInterval(
      () => setStep((s) => (s + 1) % anim.frames.length),
      1000 / anim.fps
    );
    return () => window.clearInterval(timer);
  }, [anim]);

  const { columns } = manifest;
  const frame = anim.frames[step % anim.frames.length] ?? 0;
  // Frames are square; the app picks the on-screen size (see DISPLAY_PX).
  const w = DISPLAY_PX;
  const h = DISPLAY_PX;
  return (
    <div
      className="buddy-sprite"
      role="img"
      aria-label={label}
      style={{
        width: w,
        height: h,
        backgroundImage: `url(${sheetUrl})`,
        backgroundSize: `${columns * w}px auto`,
        backgroundPosition: `-${(frame % columns) * w}px -${Math.floor(frame / columns) * h}px`,
      }}
    />
  );
}
