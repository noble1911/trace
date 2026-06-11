import type { ReactNode } from "react";

interface SettingRowProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

// One design-style settings row: label + hint on the left, control on the right.
export function SettingRow({ label, hint, children }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div>
        <div className="label">{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}
