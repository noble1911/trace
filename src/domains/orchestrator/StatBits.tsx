import type { ReactNode } from "react";

// The stats panel's building blocks: a number with its label, and a titled group.

export type StatAccent = "prog" | "working" | "needs" | "ready" | "review" | "done";

export function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: StatAccent;
}) {
  return (
    <div className="stat-cell">
      <div className={`v${accent ? ` ${accent}` : ""}`}>{value}</div>
      <div className="k">{label}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="orch-section">
      <div className="orch-section-title">{title}</div>
      {children}
    </div>
  );
}

export function Flags({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="orch-flags">
      {flags.map((f) => (
        <div key={f} className="orch-flag">
          {f}
        </div>
      ))}
    </div>
  );
}
