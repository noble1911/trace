import type { MouseEvent } from "react";
import { I } from "@/components/Icon";
import { Switch } from "@/components/Switch";
import { agentLabel } from "@/domains/agent/providerLabel";
import { describeSchedule, relative } from "./describe";
import { RunBadge } from "./RunBadge";
import type { ScheduledPrompt, ScheduleRun } from "./types";

interface ScheduleRowProps {
  prompt: ScheduledPrompt;
  /** The prompt's most recent run, if any. */
  lastRun?: ScheduleRun;
  /** Epoch secs, ticking — keeps "next in …" fresh. */
  now: number;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void;
}

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// One scheduled prompt in the list: what it is, when it next fires, how the last
// run went, and the quick actions (pause, run now).
export function ScheduleRow({
  prompt,
  lastRun,
  now,
  onOpen,
  onToggle,
  onRunNow,
}: ScheduleRowProps) {
  const live = lastRun?.status === "running";
  const stop = (e: MouseEvent) => e.stopPropagation();
  const sub = [
    describeSchedule(prompt.schedule),
    agentLabel("claude", prompt.provider),
    prompt.repo ? basename(prompt.repo) : null,
  ].filter(Boolean);

  return (
    // biome-ignore lint/a11y/useSemanticElements: hosts nested buttons; HTML forbids nested interactives
    <div
      className={`sched-row${prompt.enabled ? "" : " paused"}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
    >
      <span className="sched-row-icon">
        <I.Clock size={16} />
      </span>
      <div className="sched-row-main">
        <div className="sched-row-title">{prompt.title}</div>
        <div className="sched-row-sub">{sub.join(" · ")}</div>
      </div>
      <div className="sched-row-col">
        <span className="k">Next</span>
        <span className="v">
          {prompt.enabled && prompt.nextRunAt ? relative(prompt.nextRunAt, now) : "Paused"}
        </span>
      </div>
      <div className="sched-row-col">
        <span className="k">Last run</span>
        <span className="v">
          {lastRun ? (
            <>
              <RunBadge run={lastRun} />
              {!live && <span className="ago">{relative(lastRun.startedAt, now)}</span>}
            </>
          ) : (
            "Never"
          )}
        </span>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: click-shield so the row's own actions don't open it */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-shield only; the controls inside handle keys */}
      <div className="sched-row-actions" onClick={stop}>
        <button
          type="button"
          className="btn"
          onClick={onRunNow}
          disabled={live}
          title={live ? "A run is already going" : "Run this prompt now"}
        >
          <I.Bolt size={13} /> Run now
        </button>
        <Switch
          on={prompt.enabled}
          onChange={onToggle}
          label={prompt.enabled ? "Pause schedule" : "Resume schedule"}
        />
      </div>
    </div>
  );
}
