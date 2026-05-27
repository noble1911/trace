import type { StatusCategory } from "@/domains/jira/types";

const CATEGORY: Record<StatusCategory, { color: string; bg: string; border: string }> = {
  new: {
    color: "var(--c-todo)",
    bg: "var(--c-todo-bg)",
    border: "color-mix(in srgb, var(--c-todo) 40%, transparent)",
  },
  indeterminate: {
    color: "var(--c-prog)",
    bg: "var(--c-prog-bg)",
    border: "color-mix(in srgb, var(--c-prog) 40%, transparent)",
  },
  done: {
    color: "var(--c-done)",
    bg: "var(--c-done-bg)",
    border: "color-mix(in srgb, var(--c-done) 40%, transparent)",
  },
};

interface StatusPillProps {
  name: string;
  category: StatusCategory;
}

export function StatusPill({ name, category }: StatusPillProps) {
  const m = CATEGORY[category] ?? CATEGORY.new;
  return (
    <span
      className="status-pill"
      style={{ color: m.color, background: m.bg, borderColor: m.border }}
    >
      <span className="d" style={{ background: m.color }} />
      {name}
    </span>
  );
}
