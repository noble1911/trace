import { invoke } from "@tauri-apps/api/core";

// MCP servers for trace's agents (`commands/mcp.rs`): a curated list, the HTTP servers
// in your Claude config, and your own, each logged in to by trace and switched on for
// agents on this computer, in sandboxes, or both. Tokens and keys stay on the Rust side.

/** How a server is logged in to. */
export type McpAuth = "oauth" | "open" | "key";

/** Where it came from: trace's list, your Claude config, or added by you. */
export type McpSource = "catalog" | "config" | "custom";

export interface McpServerStatus {
  /** Its tools are called mcp__<name>__…. */
  name: string;
  url: string;
  host: string;
  source: McpSource;
  /** Its logo, for one from trace's list (several entries can share one). */
  logo: string | null;
  about: string | null;
  auth: McpAuth;
  /** For a key: what to paste. */
  keyHint: string | null;
  connected: boolean;
  /** Agents on this computer get it (through trace). */
  local: boolean;
  /** Agents in a cloud sandbox get it. */
  remote: boolean;
  /** Epoch ms the current token expires, when the server said. */
  expiresAt: number | null;
  /** trace renews it without the browser. */
  refreshable: boolean;
  /** The service retired this URL for this one: connecting there replaces it. */
  replacedBy: string | null;
}

/** What a connect rejects with when the server can't register trace itself. */
export const NEEDS_CLIENT_ID = "needs-client-id";

/** Where a server that can't register trace itself has it registered once, by hand. */
export const REDIRECT_URI = "http://127.0.0.1:47321/callback";

export function mcpServers(): Promise<McpServerStatus[]> {
  return invoke("mcp_servers");
}

/**
 * Move a server whose URL its service retired to the new one: a fresh login (the new
 * server asks for new scopes), then the old one goes, its switches kept.
 */
export function mcpMove(server: McpServerStatus, to: string): Promise<McpServerStatus[]> {
  return mcpConnect({ ...server, url: to, source: "catalog" });
}

/** Add one from the list: through the browser (OAuth), with a key, or as it is (open). */
export function mcpConnect(
  server: McpServerStatus,
  extra: { clientId?: string; key?: string } = {}
): Promise<McpServerStatus[]> {
  return invoke("mcp_connect", {
    name: server.name,
    url: server.url,
    source: server.source,
    clientId: extra.clientId ?? null,
    key: extra.key ?? null,
  });
}

/** Add your own by URL. Without a key, trace logs in if the server asks it to. */
export function mcpAdd(fields: {
  name: string;
  url: string;
  header?: string;
  key?: string;
  clientId?: string;
  /** The self-hosted service it is, for its logo. */
  logo?: string;
}): Promise<McpServerStatus[]> {
  return invoke("mcp_add", {
    name: fields.name,
    url: fields.url,
    header: fields.header ?? null,
    key: fields.key ?? null,
    clientId: fields.clientId ?? null,
    logo: fields.logo ?? null,
  });
}

export function mcpSetUse(
  url: string,
  local: boolean,
  remote: boolean
): Promise<McpServerStatus[]> {
  return invoke("mcp_set_use", { url, local, remote });
}

export function mcpDisconnect(url: string): Promise<McpServerStatus[]> {
  return invoke("mcp_disconnect", { url });
}
