// Agent launch defaults configured in Settings, read from localStorage so the
// start flows and the Settings UI share one source of truth.

const MODEL_KEY = "trace.agentModel";
const ARGS_KEY = "trace.agentArgs";

/** The default model, or undefined to use the CLI's own default. */
export function agentModel(): string | undefined {
  try {
    return localStorage.getItem(MODEL_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Extra CLI flags, split on whitespace (e.g. --dangerously-skip-permissions). */
export function agentArgs(): string[] {
  try {
    const raw = localStorage.getItem(ARGS_KEY)?.trim();
    return raw ? raw.split(/\s+/) : [];
  } catch {
    return [];
  }
}
