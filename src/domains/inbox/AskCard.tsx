import { toast } from "@/app/toast";
import { Markdown } from "@/components/Markdown";
import { StatusLight } from "@/components/StatusLight";
import { type AnswerChoice, choicesFor, choose } from "@/domains/live/answer";
import type { Ask } from "@/domains/live/types";
import { useButtonHints, useNumberedHints } from "@/platform/shortcuts";
import { titleWithHint } from "@/platform/shortcuts/hintText";

interface AskCardProps {
  workspaceId: string;
  ask: Ask;
  age: string;
}

/**
 * A sentence beside the pill, only where it tells you something the pill doesn't:
 * a permission or plan says it all in the pill ("Permission · Bash"), and an
 * answerable question shows its answers.
 */
function note(ask: Ask, answerable: boolean): string | null {
  switch (ask.kind) {
    case "permission":
    case "plan":
      return null;
    case "question":
      return answerable ? null : "Open it to answer in the terminal.";
    default:
      return "Open it to see what it needs.";
  }
}

// What a terminal agent is waiting for (the command, question or plan itself),
// drawn as the chat's ask card (`.ac-card.ac-ask`) so the same ask looks the same
// here and in a chat, with one-click answers where its prompt is a plain menu.
// Keys 1–9 pick them (named in each answer's tooltip, and as a chip when hints on
// buttons are on).
export function AskCard({ workspaceId, ask, age }: AskCardProps) {
  const choices = choicesFor(ask);
  const keys = useNumberedHints("inboxAnswer", Math.min(choices.length, 9));
  const chips = useButtonHints();
  const pick = (choice: AnswerChoice) =>
    void choose(workspaceId, choice).catch((err) => toast.error(`Couldn't answer: ${err}`));
  const said = note(ask, choices.length > 0);
  return (
    <section className="ac-card ac-ask" aria-label="What the agent needs">
      <div className="ac-card-head">
        <StatusLight light="attention" variant="pill" label={ask.label} age={age} />
        {said && <span className="ac-ask-note">{said}</span>}
      </div>
      {ask.detail &&
        // A command or path reads best as code; a question or plan as prose.
        (ask.kind === "permission" ? (
          <pre className="tx-code ac-cmd">{ask.detail}</pre>
        ) : (
          <Markdown text={ask.detail} prose className="ac-ask-text" />
        ))}
      {choices.length > 0 && (
        <div className="ac-ask-actions">
          {choices.map((c, i) => (
            <button
              key={c.label}
              type="button"
              className={`btn${i === 0 && ask.kind !== "question" ? " primary-needs" : ""}`}
              onClick={() => pick(c)}
              title={titleWithHint(c.label, keys[i] ?? "")}
            >
              {c.label}{" "}
              {chips && keys[i] && (
                <span className="kbd" aria-hidden="true">
                  {keys[i]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
