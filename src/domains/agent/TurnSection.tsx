import { shownAsk } from "@/domains/live/light";
import { useLiveStore } from "@/domains/live/store";
import { RecapSection } from "@/domains/recap/RecapSection";
import { useRecap } from "@/domains/recap/store";

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
  if (light === "attention") return `Answer: ${askLabel}`;
  if (light === "working") return "Nothing — the agent is working";
  if (light === "ready" && !hasPr && said) return "Review the changes, then raise a PR";
  if (hasPr) return "Review the pull request";
  return null;
}

// Top of the detail rail: where the agent is up to (its recap, and what happened
// since you looked), then the one thing to do about it. Its last message stands
// in for the recap until there is one (no transcript, no model, or not yet).
export function TurnSection({ workspaceId, hasPr }: TurnSectionProps) {
  const info = useLiveStore((s) => s.info[workspaceId]);
  const recap = useRecap(workspaceId);
  const step = info
    ? nextStep(info.light, shownAsk(info)?.label, hasPr, info.lastMessage != null || !!recap)
    : null;
  const lastMessage = recap ? null : (info?.lastMessage ?? null);
  // Always mounted, so a workspace with a transcript but no recap yet gets one;
  // with nothing in it the section is `:empty` and hidden (rail.css).
  return (
    <div className="ctx-section turn-section">
      <RecapSection workspaceId={workspaceId} />
      {step && (
        <div className="turn-next">
          <div className="label">Next step</div>
          <span className={`turn-step ${info?.light ?? ""}`}>{step}</span>
        </div>
      )}
      {lastMessage && (
        <>
          <div className="label">Last message</div>
          <p className="turn-said">{lastMessage}</p>
        </>
      )}
    </div>
  );
}
