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

/** Used when the catalog can't be loaded (no Claude Code), or names an id the API
 * wouldn't take: a first-party id per family. */
const FALLBACK_SDK: Record<string, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5-2",
};
const FAMILIES = Object.keys(FALLBACK_SDK);

/** Claude Code's million-token context suffix, which the API doesn't take. */
const LONG_CONTEXT = /\[1m\]$/i;

/** A plain first-party API id. Not a Vertex `…@date` one, a Bedrock `us.anthropic.…`
 * one, an ARN or a gateway's name, which the Anthropic API would refuse. */
const API_ID = /^claude-[a-z0-9-]+$/;

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
  return FAMILIES.find((f) => lower.includes(f));
}

/** The CLI value to pass: the model itself (an alias or id Claude Code listed or saved). */
export function cliModel(model: string): string {
  return model || DEFAULT_MODEL;
}

/**
 * The API model id for the SDK. Claude Code's `resolvedModel` is that id when it is a
 * plain first-party one (minus a `[1m]` suffix); a saved id likewise. Anything else (no
 * catalog, an alias it doesn't list, a cloud provider's id) gets the hardcoded id of its
 * family, Sonnet's if even that is unknown.
 */
export function sdkModelId(model: string, catalog: readonly CatalogEntry[]): string {
  const listed = catalog.find((m) => m.value === model);
  const resolved = (listed?.resolvedModel ?? model).replace(LONG_CONTEXT, "");
  if (API_ID.test(resolved)) return resolved;
  const fam = family(resolved) ?? family(model);
  return (fam && FALLBACK_SDK[fam]) || FALLBACK_SDK.sonnet;
}

/** Families and the first version that takes `thinking: {type: "adaptive"}`. */
const ADAPTIVE_FROM = new Map<string, [number, number]>([
  ["opus", [4, 6]],
  ["fable", [5, 0]],
]);

/**
 * Whether to send adaptive thinking with this API id. On for the heavy-reasoning
 * families (Opus, Fable), as the old Fast/Thorough pair did, and only from the version
 * that takes it: an older Opus (4.5 and before) answers adaptive thinking with a 400.
 * Conservative: an id that doesn't parse as `claude-<family>-<major>[-<minor>][-<date>]`
 * gets none. (Fable and the newest Opus think by themselves when it's left out.)
 */
export function takesAdaptiveThinking(apiId: string): boolean {
  const m = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(apiId);
  const from = m ? ADAPTIVE_FROM.get(m[1]) : undefined;
  if (!m || !from) return false;
  const major = Number(m[2]);
  const minor = Number(m[3] ?? 0);
  return major > from[0] || (major === from[0] && minor >= from[1]);
}

/** Thinking follows the id actually sent (`sdkModelId`), so a fallback never gets it wrong. */
export function usesThinking(model: string, catalog: readonly CatalogEntry[]): boolean {
  return takesAdaptiveThinking(sdkModelId(model, catalog));
}
