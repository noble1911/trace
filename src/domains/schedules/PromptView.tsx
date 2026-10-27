import { agentLabel } from "@/domains/agent/providerLabel";
import type { ScheduledPrompt } from "./types";

interface PromptViewProps {
  prompt: ScheduledPrompt;
  /** What a run actually sent (variables filled in); empty for the saved template. */
  sent?: string;
}

// The Prompt tab: the full prompt at the viewer's width, and how it runs. A run
// shows the text it was sent, since `{date}`/`{lastRunAt}` differ per run.
export function PromptView({ prompt, sent }: PromptViewProps) {
  const settings = [
    agentLabel("claude", prompt.provider),
    prompt.model,
    prompt.extraArgs.join(" "),
    prompt.timeoutMins > 0 ? `${prompt.timeoutMins}m timeout` : "no timeout",
  ].filter(Boolean);
  const text = sent || prompt.prompt;

  return (
    <div className="sched-prompt-view">
      <div className="sched-prompt-meta">
        {sent ? "As sent in this run" : "Saved prompt"} · {settings.join(" · ")}
      </div>
      <div className="sched-prompt-text">{text}</div>
    </div>
  );
}
