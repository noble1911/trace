import { type Density, useDensity } from "./density";

const OPTIONS: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "standard", label: "Standard" },
  { value: "rich", label: "Rich" },
];

// Card density for the board — a segmented control; the choice persists.
export function DensityToggle() {
  const density = useDensity((s) => s.density);
  const setDensity = useDensity((s) => s.setDensity);
  return (
    <fieldset className="seg" aria-label="Card density">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={density === o.value}
          className={density === o.value ? "on" : undefined}
          onClick={() => setDensity(o.value)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
