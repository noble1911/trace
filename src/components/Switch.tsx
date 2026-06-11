interface SwitchProps {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Accessible name — the visual label lives in the surrounding setting-row. */
  label: string;
}

// iOS-style toggle from the design (.switch / .switch.on).
export function Switch({ on, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      className={`switch${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}
