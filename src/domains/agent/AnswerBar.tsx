import { toast } from "@/app/toast";
import { choicesFor, choose } from "@/domains/live/answer";
import { useLiveStore } from "@/domains/live/store";

// Docked under the chat while the agent waits on a menu prompt (a permission,
// a plan, a single-choice question): the same answers as the terminal's, one
// click away. The terminal still works — this just saves finding the prompt.
export function AnswerBar({ workspaceId }: { workspaceId: string }) {
  const ask = useLiveStore((s) => s.info[workspaceId]?.ask ?? null);
  const choices = choicesFor(ask);
  if (!ask || choices.length === 0) return null;
  const what =
    ask.kind === "question"
      ? (ask.detail ?? "The agent has a question")
      : ask.kind === "plan"
        ? "The agent has a plan for you to approve"
        : `The agent asks to use ${ask.tool ?? "a tool"}${ask.detail ? `: ${ask.detail}` : ""}`;
  return (
    <fieldset className="answer-bar" aria-label="Answer the agent">
      <span className="answer-text" title={what}>
        {what}
      </span>
      {choices.map((c, i) => (
        <button
          key={c.label}
          type="button"
          className={`btn${i === 0 && ask.kind !== "question" ? " primary-needs" : ""}`}
          onClick={() =>
            void choose(workspaceId, c).catch((err) => toast.error(`Couldn't answer: ${err}`))
          }
        >
          {c.label}
        </button>
      ))}
    </fieldset>
  );
}
