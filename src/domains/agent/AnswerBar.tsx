import { toast } from "@/app/toast";
import { CHOICES, choose } from "@/domains/live/answer";
import { useLiveStore } from "@/domains/live/store";

// Docked under the chat while the agent waits on a menu prompt (permission,
// plan approval): the same answers as the terminal's, one click away. The
// terminal still works — this just saves finding the prompt in it.
export function AnswerBar({ workspaceId }: { workspaceId: string }) {
  const ask = useLiveStore((s) => s.info[workspaceId]?.ask ?? null);
  const choices = ask ? CHOICES[ask.kind] : undefined;
  if (!ask || !choices) return null;
  return (
    <fieldset className="answer-bar" aria-label="Answer the agent">
      <span className="answer-text">
        {ask.kind === "plan"
          ? "The agent has a plan for you to approve"
          : `The agent asks permission${ask.tool ? ` to use ${ask.tool}` : ""}`}
      </span>
      {choices.map((c, i) => (
        <button
          key={c.choice}
          type="button"
          className={`btn${i === 0 ? " primary-needs" : ""}`}
          onClick={() =>
            void choose(workspaceId, c.choice).catch((err) =>
              toast.error(`Couldn't answer: ${err}`)
            )
          }
        >
          {c.label}
        </button>
      ))}
    </fieldset>
  );
}
