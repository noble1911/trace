// What the live-agent lists remember across launches: when each running agent
// was opened (so opened order survives a restart that re-adopts its PTY) and
// the user's dragged order. Best-effort — blocked storage just forgets.

const OPENED_KEY = "trace.agentOpenedAt";
const ORDER_KEY = "trace.agentOrder";

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

export function loadOpenedAt(): Record<string, number> {
  const v = read(OPENED_KEY);
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, number> = {};
  for (const [k, t] of Object.entries(v)) if (typeof t === "number") out[k] = t;
  return out;
}

export function saveOpenedAt(map: Record<string, number>) {
  write(OPENED_KEY, map);
}

/** `null` = never dragged: plain opened order. */
export function loadManualOrder(): string[] | null {
  const v = read(ORDER_KEY);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
}

export function saveManualOrder(order: string[] | null) {
  write(ORDER_KEY, order);
}
