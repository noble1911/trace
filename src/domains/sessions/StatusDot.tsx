import { type AgentLight, LIGHT_LABEL } from "./agentRoster";

interface StatusDotProps {
  light: AgentLight;
  /** Tooltip — per-agent breakdown for multi-agent sessions; the label otherwise. */
  detail?: string;
  /** Show the state as a word beside the dot (list rows have room; Recents doesn't). */
  labelled?: boolean;
}

/**
 * A session's state at a glance: amber pulsing working, blinking violet needs
 * you, green ready (alive at its prompt, already seen), hollow grey stopped.
 */
export function StatusDot({ light, detail, labelled }: StatusDotProps) {
  const title = detail ?? LIGHT_LABEL[light];
  if (!labelled) return <span className={`session-dot ${light}`} title={title} />;
  return (
    <span className={`session-light ${light}`} title={title}>
      <span className={`session-dot ${light}`} />
      {LIGHT_LABEL[light]}
    </span>
  );
}
