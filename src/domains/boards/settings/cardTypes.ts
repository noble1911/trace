// A custom board's card types, as the settings dialog edits them. Pure, for tests.

export interface NamedType {
  id: string;
  name: string;
}

/** Why a type name can't be saved, or null. Names are matched case-insensitively,
 * since a card's brief finds its type by name. */
export function typeNameProblem(raw: string, types: NamedType[], exceptId?: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "") return "A type needs a name.";
  const taken = types.some((t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase());
  return taken ? `There's already a type called ${name}.` : null;
}

/** How many cards have a type (they carry it by name). */
export function typeCardCount(issues: { issueType: string }[], name: string): number {
  return issues.filter((i) => i.issueType === name).length;
}

/** Where a deleted type's cards can go: every other type, in order. */
export function typeMoveTargets<T extends NamedType>(types: T[], id: string): T[] {
  return types.filter((t) => t.id !== id);
}

/**
 * Where a deleted type's cards go: the choice while it's still offered ("" is no type),
 * else the first other type, else none. Types change while the prompt is open (one can be
 * deleted from its own row), so a choice that's gone is never sent.
 */
export function deleteTarget(targets: NamedType[], chosen: string): string {
  if (chosen === "" || targets.some((t) => t.id === chosen)) return chosen;
  return targets[0]?.id ?? "";
}
