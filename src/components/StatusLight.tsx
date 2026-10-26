import { LIGHT_LABEL } from "@/domains/live/light";
import type { AgentLight } from "@/domains/live/types";

interface StatusLightProps {
  light: AgentLight;
  /**
   * `dot` — the light alone (tabs, Recents); `word` — dot + label (list rows);
   * `pill` — a tinted pill (cards, headers, inbox).
   */
  variant?: "dot" | "word" | "pill";
  /** Overrides the state word — what the agent asks for, e.g. "Permission · Bash". */
  label?: string;
  /** How long it's been like this ("6m"), shown after the label. */
  age?: string;
  /** Tooltip — e.g. a per-agent breakdown; the label otherwise. */
  title?: string;
}

/**
 * An agent's state, the same everywhere: blinking amber needs you, blue
 * spinner working, green ready, hollow grey stopped (see `--state-*` tokens).
 */
export function StatusLight({ light, variant = "dot", label, age, title }: StatusLightProps) {
  const text = label ?? LIGHT_LABEL[light];
  const tip = title ?? (age ? `${text} · ${age}` : text);
  const dot = <span className={`light-dot ${light}`} aria-hidden={variant !== "dot"} />;
  if (variant === "dot") {
    return <span className={`light-dot ${light}`} title={tip} role="img" aria-label={tip} />;
  }
  return (
    <span className={`light-${variant} ${light}`} title={tip}>
      {dot}
      <span className="light-text">{text}</span>
      {age && <span className="light-age">{age}</span>}
    </span>
  );
}
