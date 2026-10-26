import { toast } from "@/app/toast";
import { StatusLight } from "@/components/StatusLight";
import { CHOICES, type Choice, choose } from "@/domains/live/answer";
import type { Ask } from "@/domains/live/types";

interface AskCardProps {
  workspaceId: string;
  ask: Ask;
  age: string;
}

const HINT: Record<Ask["kind"], string> = {
  permission: "is asking for permission",
  plan: "has a plan for you to approve",
  question: "has a question — answer it in the terminal",
  input: "is waiting for your input",
  turn: "finished its turn",
};

// What the agent is waiting for, with one-click answers where its prompt is a
// simple menu (permission, plan approval). Keys 1–3 pick them from the list.
export function AskCard({ workspaceId, ask, age }: AskCardProps) {
  const choices = CHOICES[ask.kind] ?? [];
  const pick = (choice: Choice) =>
    void choose(workspaceId, choice).catch((err) => toast.error(`Couldn't answer: ${err}`));
  return (
    <section className="ib-card ask" aria-label="What the agent needs">
      <div className="ib-ask-head">
        <StatusLight light="attention" variant="pill" label={ask.label} age={age} />
        <span className="ib-hint">
          The agent {HINT[ask.kind]}
          {ask.tool && ask.kind === "permission" ? ` to use ${ask.tool}` : ""}.
        </span>
      </div>
      {choices.length > 0 && (
        <div className="ib-choices">
          {choices.map((c, i) => (
            <button
              key={c.choice}
              type="button"
              className={`btn${i === 0 ? " primary-needs" : ""}`}
              onClick={() => pick(c.choice)}
            >
              {c.label} <span className="kbd">{i + 1}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
