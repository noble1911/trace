import { I } from "@/components/Icon";
import { PopMenu } from "@/components/PopMenu";
import type { AgentCli, AgentProvider } from "@/ipc/agent";
import { AGENT_OPTIONS, isChosen } from "./agentOptions";
import { agentLabel } from "./providerLabel";

interface StartSplitButtonProps {
  cli: AgentCli;
  provider: AgentProvider;
  onStart: () => void;
  onChoose: (cli: AgentCli, provider: AgentProvider) => void;
}

// "Start Claude ▾": one click starts the chosen agent; the caret picks which
// (CLI + model provider) — replacing the two selects that sat beside Start.
export function StartSplitButton({ cli, provider, onStart, onChoose }: StartSplitButtonProps) {
  return (
    <div className="split-btn">
      <button type="button" className="btn primary" onClick={onStart}>
        <I.Bolt size={13} /> Start {agentLabel(cli, provider)}
      </button>
      <PopMenu
        trigger={({ toggle }) => (
          <button
            type="button"
            className="btn primary"
            onClick={toggle}
            title="Choose which agent to start"
            aria-label="Choose which agent to start"
          >
            <span className="caret">
              <I.Chevron size={12} />
            </span>
          </button>
        )}
        sections={[
          {
            title: "Agent",
            items: AGENT_OPTIONS.map((o) => ({
              label: o.label,
              checked: isChosen(o, cli, provider),
              onSelect: () => onChoose(o.cli, o.provider),
            })),
          },
        ]}
      />
    </div>
  );
}
