import { invoke } from "@tauri-apps/api/core";

// The renderer's side of the tools trace serves its own agents over MCP
// (`agent_tools` in Rust): register what's offered, answer what's called.

/** An MCP tool definition. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** Replace the tool definitions trace offers its agents. */
export function setAgentTools(tools: McpTool[]): Promise<void> {
  return invoke("set_agent_tools", { tools });
}

/** Answer an `agent-tool-call`. */
export function agentToolResult(id: string, text: string, isError: boolean): Promise<void> {
  return invoke("agent_tool_result", { id, text, isError });
}
