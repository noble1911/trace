// Which brief a start sends: the card type's prompt, else the board's, else the global
// one from Settings. Pure, so the order is tested on its own; `briefSource.ts` gathers
// the three at launch.

/** A card type as far as the brief cares: its name (what `Issue.issueType` carries). */
export interface TypePrompt {
  name: string;
  prompt: string | null;
}

/** The prompt of the type a card has (matched by name), or null. */
export function typePromptFor(types: TypePrompt[], issueType: string): string | null {
  return types.find((t) => t.name === issueType)?.prompt ?? null;
}

export interface BriefSources {
  /** The card type's prompt (custom boards). */
  typePrompt?: string | null;
  /** The board's kickoff prompt (any board). */
  boardPrompt?: string | null;
  /** Settings → Kickoff prompt, already defaulted. */
  globalTemplate: string;
}

/** The first of type → board → global that has something in it. */
export function resolveBriefTemplate({
  typePrompt,
  boardPrompt,
  globalTemplate,
}: BriefSources): string {
  for (const candidate of [typePrompt, boardPrompt]) {
    if (candidate && candidate.trim() !== "") return candidate;
  }
  return globalTemplate;
}
