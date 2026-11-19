import { useMemo } from "react";
import { modelLabel } from "./agentOptionsFormat";
import { BackgroundWork } from "./BackgroundWork";
import { backgroundItems } from "./background";
import { ContextGauge } from "./ContextGauge";
import { formatCost, limitLabel, resetsIn } from "./format";
import type { ChatTurn } from "./projection";
import type { SubagentThread } from "./subagents";
import type { LimitWindow, SessionInfo } from "./types";

// The chat's fact strip: which agent and model (picked in the composer,
// `AgentOptionPickers`), the session's cost so far, how full the context window
// is, and the usage-limit windows the agent reports (how full, and when each resets).
// While anything runs behind the conversation (subagents, a background shell, a
// workflow), a small control lists it (`BackgroundWork`).
// Stopping the agent is the detail header's; interrupting a turn, the composer's.

interface ChatHeaderProps {
  workspaceId: string;
  info: SessionInfo | undefined;
  turns: ChatTurn[];
  subagents: SubagentThread[];
}

export function ChatHeader({ workspaceId, info, turns, subagents }: ChatHeaderProps) {
  const tasks = info?.background;
  const background = useMemo(() => backgroundItems(subagents, tasks ?? []), [subagents, tasks]);
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
      <BackgroundWork workspaceId={workspaceId} items={background} />
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
