import type { ReactNode } from "react";
import { I } from "@/components/Icon";
import type { Issue } from "@/domains/issues/types";
import type { Coming } from "@/domains/panes/coming";
import { runSection } from "@/domains/panes/registry";
import type { PanelDescriptor } from "@/domains/panes/types";
import { planTab } from "@/domains/plans/planTab";
import type { PlanTabState } from "@/domains/plans/store";
import type { AgentCli } from "@/ipc/agent";
import { AgentViewSwitch } from "./AgentViewSwitch";
import { prTab, testsTab } from "./reviewTabs";
import { ticketTabsFor } from "./runsOn";
import { TicketPane } from "./TicketPane";
import { type ViewerTabsState, viewerTabs } from "./viewerTabs";
import { filesTab, terminalTab, type WorkspaceTabsState } from "./workspaceTabs";

/** The ticket agent's tab id; subagent panels open beside it. */
export const TICKET_CHAT_TAB = "chat";

interface TicketPanelsArgs {
  issue: Issue;
  /** The Jira site, for the Ticket tab's links. */
  site: string | null;
  cli: AgentCli;
  /** The agent's own view: its chat, or its terminal under the start prompt. */
  chat: ReactNode;
  plan: PlanTabState;
  viewers: ViewerTabsState;
  /** Files and Terminal: shown only with changes, or a shell open. */
  workspace: WorkspaceTabsState;
  /** Tests and Pull request, under the tabs rule. */
  tests: Coming;
  pr: Coming;
  prUrls: string[];
  /** Started in a sandbox: no local worktree behind Terminal and Tests. */
  remote: boolean;
  /** The sandbox can read its checkout, so Files stays. */
  filesInSandbox: boolean;
}

/**
 * A ticket's tabs, in their natural order (⌘1–7, counting only those shown): the
 * agent's, with its subagents' after it, then the rest.
 */
export function ticketPanels(a: TicketPanelsArgs) {
  const { issue, site, cli, chat, plan, viewers, workspace, tests, pr, prUrls } = a;
  const has = ticketTabsFor(a.remote, a.filesInSandbox);
  const panels: PanelDescriptor[] = [
    {
      id: TICKET_CHAT_TAB,
      label: "Chat",
      icon: I.Chat,
      // Its subagents' tabs follow it in its run; a rule divides the run from the rest.
      section: runSection(issue.key),
      toolbar: <AgentViewSwitch workspaceId={issue.key} cli={cli} />,
      render: () => chat,
    },
    planTab({ workspaceId: issue.key, agentTab: TICKET_CHAT_TAB, state: plan }),
    ...viewerTabs(issue.key, viewers),
    {
      id: "ticket",
      label: "Ticket",
      icon: I.Ticket,
      render: () => <TicketPane issue={issue} site={site} />,
    },
    ...(has.files ? [filesTab(issue.key, workspace)] : []),
    ...(has.terminal ? [terminalTab(issue.key, workspace)] : []),
    ...(has.tests ? [testsTab(issue.key, tests)] : []),
    prTab(prUrls, pr),
  ];
  return panels;
}
