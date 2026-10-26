import { useEffect } from "react";
import { agentToolResult, setAgentTools } from "@/ipc/agentTools";
import { onAgentToolCall } from "@/ipc/events";
import { mcpTools, runAgentTool } from "./registry";

/**
 * Serve trace's own tools to its agents: register them with the backend's MCP
 * endpoint and answer each call it hands over. Mounted once, app-wide — a call
 * can come from any agent whatever view is showing.
 */
export function useAgentTools(): void {
  useEffect(() => {
    void setAgentTools(mcpTools());
    // Same late-registration guard as useAppEvents: under StrictMode a listener
    // that resolves after cleanup must unlisten at once, or every call runs twice.
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onAgentToolCall(({ id, name, arguments: input }) => {
      runAgentTool(name, input)
        .then((text) => agentToolResult(id, text, false))
        .catch((e) => agentToolResult(id, e instanceof Error ? e.message : String(e), true));
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
