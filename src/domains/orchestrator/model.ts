// The assistant's model: one of what the installed Claude Code lists (its own
// aliases, `opus`, `sonnet`), kept as the value `--model` takes. Pure mapping
// only (no store, no IPC) so it can be tested: the CLI path takes that value as
// is, the SDK path needs an API id, which the catalog's `resolvedModel` gives.

/** The slice of a catalog model this needs (see `ClaudeModel` in ipc/claudeCatalog). */
export interface CatalogEntry {
  value: string;
  resolvedModel: string;
}

/** What the assistant used before the catalog: fast = Sonnet, thorough = Opus. */
export const DEFAULT_MODEL = "sonnet";

/** Used when the catalog can't be loaded (no Claude Code): the old hardcoded ids. */
const FALLBACK_SDK: Record<string, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
};
const FALLBACK_FAMILIES = Object.keys(FALLBACK_SDK);

/** Claude Code's million-token context suffix, which the API doesn't take. */
const LONG_CONTEXT = /\[1m\]$/i;

/**
 * The saved model: the new value if there is one, else the old speed setting
 * mapped to its closest alias (fast → sonnet, thorough → opus), else Sonnet.
 */
export function migrateModel(saved: string | null, legacySpeed: string | null): string {
  if (saved) return saved;
  return legacySpeed === "thorough" ? "opus" : DEFAULT_MODEL;
}

function family(text: string): string | undefined {
  const lower = text.toLowerCase();
  return [...FALLBACK_FAMILIES, "fable"].find((f) => lower.includes(f));
}

/** The CLI value to pass: the model itself (an alias or id Claude Code listed or saved). */
export function cliModel(model: string): string {
  return model || DEFAULT_MODEL;
}

/**
 * The API model id for the SDK. Claude Code's `resolvedModel` is that id when it
 * is a `claude-…` one (minus a `[1m]` suffix); a saved id is used as is. When
 * neither is known (no catalog, an alias it doesn't list) the closest of the old
 * hardcoded ids by family, Sonnet if even that is unknown.
 */
export function sdkModelId(model: string, catalog: readonly CatalogEntry[]): string {
  const listed = catalog.find((m) => m.value === model);
  const resolved = (listed?.resolvedModel ?? model).replace(LONG_CONTEXT, "");
  if (resolved.startsWith("claude-")) return resolved;
  const fam = family(resolved) ?? family(model);
  return (fam && FALLBACK_SDK[fam]) || FALLBACK_SDK.sonnet;
}

/**
 * Extended (adaptive) thinking: on for the heavy-reasoning families (Opus, Fable),
 * off for the quick ones, as the old Fast/Thorough pair did. Derived, not a second
 * setting, so picking a model is the only choice.
 */
export function usesThinking(model: string, catalog: readonly CatalogEntry[]): boolean {
  const resolved = catalog.find((m) => m.value === model)?.resolvedModel ?? model;
  const fam = family(resolved) ?? family(model);
  return fam === "opus" || fam === "fable";
}
