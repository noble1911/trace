import { toast } from "@/app/toast";
import { StatusLight } from "@/components/StatusLight";
import { type AnswerChoice, choicesFor, choose } from "@/domains/live/answer";
import type { Ask } from "@/domains/live/types";

interface AskCardProps {
  workspaceId: string;
  ask: Ask;
  age: string;
}

/** One line on what the agent is waiting for. */
function hint(ask: Ask, answerable: boolean): string {
  switch (ask.kind) {
    case "permission":
      return `The agent asks permission${ask.tool ? ` to use ${ask.tool}` : ""}.`;
    case "plan":
      return "The agent has a plan for you to approve.";
    case "question":
      return answerable
        ? "The agent has a question — pick an answer, or open it to type your own."
        : "The agent has a question — open it to answer in the terminal.";
    case "turn":
      return "The agent finished its turn.";
    default:
      return "The agent is waiting for you — open it to see what it needs.";
  }
}

// What the agent is waiting for — the command, question or plan itself — with
// one-click answers where its prompt is a plain menu. Keys 1–9 pick them.
export function AskCard({ workspaceId, ask, age }: AskCardProps) {
  const choices = choicesFor(ask);
  const pick = (choice: AnswerChoice) =>
    void choose(workspaceId, choice).catch((err) => toast.error(`Couldn't answer: ${err}`));
  // A command or path reads best as code; a question or plan as prose.
  const code = ask.kind === "permission";
  return (
    <section className="ib-card ask" aria-label="What the agent needs">
      <div className="ib-ask-head">
        <StatusLight light="attention" variant="pill" label={ask.label} age={age} />
        <span className="ib-hint">{hint(ask, choices.length > 0)}</span>
      </div>
      {ask.detail &&
        (code ? (
          <pre className="ib-ask-detail mono">{ask.detail}</pre>
        ) : (
          <p className="ib-ask-question">{ask.detail}</p>
        ))}
      {choices.length > 0 && (
        <div className="ib-choices">
          {choices.map((c, i) => (
            <button
              key={c.label}
              type="button"
              className={`btn${i === 0 && ask.kind !== "question" ? " primary-needs" : ""}`}
              onClick={() => pick(c)}
            >
              {c.label} {i < 9 && <span className="kbd">{i + 1}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
