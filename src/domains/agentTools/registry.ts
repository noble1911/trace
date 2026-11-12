import type Anthropic from "@anthropic-ai/sdk";
import { runWriteTool, WRITE_TOOL_NAMES, WRITE_TOOLS } from "@/domains/orchestrator/mutations";
import { READ_TOOLS, runReadTool } from "@/domains/orchestrator/tools";
import { offTools, tabOfTool, useTabSettings } from "@/domains/panes/tabSettings";
import type { McpTool } from "@/ipc/agentTools";
import { isMoreTool, MORE_TOOLS, runMoreTool } from "./moreTools";
import { PUBLISH_DOCUMENT, runPublishDocument } from "./publishTool";
import { runScheduleTool, SCHEDULE_TOOLS } from "./scheduleTools";
import { isSessionTool, runSessionTool, SESSION_TOOLS } from "./sessionTools";
import { runUpdateUser, UPDATE_USER } from "./updateTool";
import { isViewerTool, runViewerTool, VIEWER_TOOLS } from "./viewerTools";

// The tools trace offers its own agents over MCP: every board (read, move, comment, start
// agents, cards on trace's own boards), scheduled prompts,
// standalone sessions (`sessionTools`), publishing a document to the Plan tab, and
// showing a page or images in the Browser and Gallery tabs (`viewerTools`). The board ones are the
// orchestrator's — same definitions, same store, same effects as the in-app
// assistant — so an agent on an epic can move its tickets and start agents on
// them without spawning sub-agents. Unlike the assistant, there's no confirm
// card: agents act on their own (except add_repo / clone_repo, `moreTools`).

const SCHEDULE_TOOL_NAMES = new Set(SCHEDULE_TOOLS.map((t) => t.name));

const TOOLS: Anthropic.Tool[] = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  ...SCHEDULE_TOOLS,
  ...SESSION_TOOLS,
  UPDATE_USER,
  ...MORE_TOOLS,
  PUBLISH_DOCUMENT,
  ...VIEWER_TOOLS,
];

/** The tool definitions in MCP's shape, less those of tabs turned off in Settings → Layout → Tabs. */
export function mcpTools(): McpTool[] {
  const off = offTools(useTabSettings.getState().off);
  return TOOLS.filter((t) => !off.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.input_schema,
  }));
}

/** Run one tool for the agent `caller` (its workspace id). Returns the text for the model. */
export async function runAgentTool(name: string, input: unknown, caller: string): Promise<string> {
  // An agent started before its tab was turned off still has the tool: say why it's gone.
  const tab = tabOfTool(name);
  if (tab && offTools(useTabSettings.getState().off).has(name)) {
    throw new Error(`The ${tab.label} tab is turned off in trace's Settings → Layout.`);
  }
  if (name === UPDATE_USER.name) return runUpdateUser(input, caller);
  if (name === PUBLISH_DOCUMENT.name) return runPublishDocument(input, caller);
  if (isViewerTool(name)) return runViewerTool(name, input, caller);
  if (WRITE_TOOL_NAMES.has(name)) return runWriteTool(name, input, "agent");
  if (SCHEDULE_TOOL_NAMES.has(name)) return runScheduleTool(name, input);
  if (isSessionTool(name)) return runSessionTool(name, input, caller);
  if (isMoreTool(name)) return runMoreTool(name, input, caller);
  return runReadTool(name, input);
}
