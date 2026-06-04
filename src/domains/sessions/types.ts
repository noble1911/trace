import type { AgentCli } from "@/ipc/agent";

/** An exploratory session — an interactive agent not tied to a Jira issue. */
export interface ScratchSession {
  id: string;
  title: string;
  cli: AgentCli;
  /** Unix epoch seconds at creation. */
  createdAt: number;
}
