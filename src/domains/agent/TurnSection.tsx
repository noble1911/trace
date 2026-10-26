import { shownAsk } from "@/domains/live/light";
import { useLiveStore } from "@/domains/live/store";

interface TurnSectionProps {
  workspaceId: string;
  /** Whether the workspace has a pull request already. */
  hasPr: boolean;
}

/** The one thing to do next, from the agent's state and whether a PR exists. */
function nextStep(
  light: string,
  askLabel: string | undefined,
  hasPr: boolean,
  said: boolean
): string | null {
  if (light === "attention")
    return askLabel === "Turn finished" ? "Read its reply" : `Answer: ${askLabel}`;
  if (light === "working") return "Nothing — the agent is working";
  if (light === "ready" && !hasPr && said) return "Review the changes, then raise a PR";
  if (hasPr) return "Review the pull request";
  return null;
}

// Top of the detail rail: what the agent last said, and what to do about it.
export function TurnSection({ workspaceId, hasPr }: TurnSectionProps) {
  const info = useLiveStore((s) => s.info[workspaceId]);
  if (!info) return null;
  const step = nextStep(info.light, shownAsk(info)?.label, hasPr, info.lastMessage != null);
  if (!info.lastMessage && !step) return null;
  return (
    <div className="ctx-section turn-section">
      {step && (
        <div className="turn-next">
          <div className="label">Next step</div>
          <span className={`turn-step ${info.light}`}>{step}</span>
        </div>
      )}
      {info.lastMessage && (
        <>
          <div className="label">Last message</div>
          <p className="turn-said">{info.lastMessage}</p>
        </>
      )}
    </div>
  );
}
