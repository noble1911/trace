import { I } from "@/components/Icon";
import { PopMenu } from "@/components/PopMenu";
import { AGENT_OPTIONS } from "@/domains/agent/agentOptions";
import type { AgentCli, AgentProvider } from "@/ipc/agent";

interface AddAgentMenuProps {
  onAdd: (cli: AgentCli, provider?: AgentProvider) => void;
  /** True at the companion cap — the trigger stays visible but inert. */
  disabled?: boolean;
}

// "+" in the session's tab bar: picks which CLI joins the session's worktree.
// A popover rather than a modal — adding an agent is a one-click decision.
export function AddAgentMenu({ onAdd, disabled }: AddAgentMenuProps) {
  return (
    <div className="add-agent">
      <PopMenu
        align="left"
        trigger={({ toggle }) => (
          <button
            type="button"
            className="add-agent-btn"
            onClick={toggle}
            disabled={disabled}
            title={
              disabled
                ? "This session already has the maximum number of agents"
                : "Add another agent in this session's worktree"
            }
            aria-label="Add an agent to this session"
          >
            <I.Plus size={13} />
          </button>
        )}
        sections={[
          {
            title: "Add agent · same worktree",
            items: AGENT_OPTIONS.map((o) => ({
              id: `${o.cli}:${o.provider}`,
              label: <span className={`session-cli ${o.cli}`}>{o.label.toLowerCase()}</span>,
              // The backend treats "no provider" as Anthropic.
              onSelect: () => onAdd(o.cli, o.provider === "anthropic" ? undefined : o.provider),
            })),
          },
        ]}
      />
    </div>
  );
}
