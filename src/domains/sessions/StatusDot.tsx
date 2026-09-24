interface StatusDotProps {
  working: boolean;
  /** Waiting on you and not yet looked at — blinks. */
  needsYou: boolean;
}

/** A session's state at a glance: blue working, blinking amber needs you, grey idle. */
export function StatusDot({ working, needsYou }: StatusDotProps) {
  const state = needsYou ? "attention" : working ? "working" : null;
  return (
    <span
      className={`session-dot${state ? ` ${state}` : ""}`}
      title={needsYou ? "Needs you" : working ? "Working" : "Idle"}
    />
  );
}
