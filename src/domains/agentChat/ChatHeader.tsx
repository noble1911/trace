import { modelLabel } from "./agentOptionsFormat";
import { ContextGauge } from "./ContextGauge";
import { formatCost, limitLabel, resetsIn } from "./format";
import type { ChatTurn } from "./projection";
import type { LimitWindow, SessionInfo } from "./types";

// The chat's fact strip: which agent and model (picked in the composer,
// `AgentOptionPickers`), the session's cost so far, how full the context window
// is, where its recap says it's up to (`domains/recap`; the full recap is in
// Details), and the usage-limit windows the agent reports (how full, and when each resets).
// Stopping the agent is the detail header's; interrupting a turn, the composer's.

interface ChatHeaderProps {
  info: SessionInfo | undefined;
  turns: ChatTurn[];
  /** The recap's "Now" line, if the agent has one. */
  now?: string | null;
}

export function ChatHeader({ info, turns, now }: ChatHeaderProps) {
  let cost = 0;
  let hasCost = false;
  for (const t of turns) {
    const c = t.summary?.usage?.costUsd;
    if (c !== undefined) {
      cost += c;
      hasCost = true;
    }
  }
  return (
    <div className="ac-head">
      <span className="ac-head-agent">{info?.agent ?? "Agent"}</span>
      {info?.model && (
        <span
          className="ac-head-model"
          title="The model in use. Change it from the composer's model picker."
        >
          {modelLabel(info.model)}
        </span>
      )}
      {hasCost && (
        <span className="ac-head-fact" title="Cost of this conversation so far">
          {formatCost(cost)}
        </span>
      )}
      {now && (
        <span className="ac-head-now" title={now}>
          <span className="ac-head-now-label">Now</span> {now}
        </span>
      )}
      <span className="ac-head-limits">
        <ContextGauge context={info?.context} agent={info?.agent} />
        {(info?.limits ?? []).map((w) => (
          <Limit key={w.name} window={w} />
        ))}
      </span>
    </div>
  );
}

function Limit({ window: w }: { window: LimitWindow }) {
  const pct = Math.round(Math.min(1, Math.max(0, w.utilization)) * 100);
  // Neutral, then red at the critical step, as the context gauge is.
  const level = pct >= 95 ? " full" : "";
  const reset = resetsIn(w.resetsAt, Date.now());
  const label = limitLabel(w.name);
  return (
    <span
      className={`ac-limit${level}`}
      title={`${label} limit: ${pct}% used${reset ? `, resets ${reset}` : ""}`}
    >
      <span className="ac-limit-name">{label}</span>
      <span className="ac-limit-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="ac-limit-pct">{pct}%</span>
      {reset && <span className="ac-limit-reset">{reset}</span>}
    </span>
  );
}
