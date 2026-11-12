// Self-hosted services with an MCP server: each team runs its own, so there's no one
// URL for trace's list. Each is a card that asks for your instance's address and a
// name, then adds it like any server of your own (`AddMcpDialog`), keeping the
// service's logo. Connect as many as you run (staging, production…), each named
// for its tools. Pure (no imports), so `npm test` runs it.

export interface SelfHostedService {
  /** Its logo (`mcpLogos/<id>.svg`), and the first name offered. */
  id: string;
  label: string;
  about: string;
  /** Where its MCP server is on an instance. */
  path: string;
  /** An example address, for the field's placeholder. */
  example: string;
}

export const SELF_HOSTED: SelfHostedService[] = [
  {
    id: "metabase",
    label: "Metabase",
    about: "Questions, dashboards and SQL on your Metabase",
    path: "/api/mcp",
    example: "metabase.example.com",
  },
];

/**
 * The MCP server's URL from what someone typed: a bare address
 * ("metabase.example.com") gets https and the service's path; a URL with a path
 * is taken as it is. Null when it isn't an address.
 */
export function serverUrl(typed: string, service: SelfHostedService): string | null {
  const text = typed.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path || service.path}`;
}

/** `base`, or `base-2`, `base-3`…: the first name no server has yet. */
export function freeName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
