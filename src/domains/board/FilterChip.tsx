import type { ReactNode } from "react";

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function FilterChip({ active, onClick, children }: FilterChipProps) {
  return (
    <button type="button" className={`filter-chip${active ? " active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
