import type { Assignee } from "@/domains/jira/types";

type Size = "md" | "lg" | "xl";

/** Deterministic hue from a seed so each person keeps a stable color. */
function hueColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `oklch(0.75 0.15 ${h})`;
}

interface AgentAvatarProps {
  assignee?: Assignee | null;
  size?: Size;
}

export function AgentAvatar({ assignee, size = "md" }: AgentAvatarProps) {
  const initial = assignee?.initial ?? "?";
  const seed = assignee?.accountId || assignee?.displayName || "unassigned";
  const cls =
    size === "lg" ? "agent-avatar lg" : size === "xl" ? "agent-avatar xl" : "agent-avatar";
  return (
    <span
      className={cls}
      style={{ background: hueColor(seed) }}
      title={assignee?.displayName ?? "Unassigned"}
    >
      {initial}
    </span>
  );
}
