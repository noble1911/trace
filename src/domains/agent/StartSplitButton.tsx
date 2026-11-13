import { I } from "@/components/Icon";
import { SplitButton } from "@/components/SplitButton";
import { defaultTransport, useHasChat } from "@/domains/agentChat/transport";
import type { AgentCli, AgentProvider, Transport } from "@/ipc/agent";
import { AGENT_OPTIONS, isChosen } from "./agentOptions";
import { agentLabel } from "./providerLabel";
import type { RunsOnState } from "./runsOn";

interface StartSplitButtonProps {
  cli: AgentCli;
  provider: AgentProvider;
  onStart: () => void;
  onChoose: (cli: AgentCli, provider: AgentProvider) => void;
  /** Chat or terminal for this start; undefined = what it ran on last, else Settings' default. */
  transport: Transport | undefined;
  onChooseTransport: (transport: Transport) => void;
  /** Where it runs; the choice shows only while Vercel is connected. */
  runsOn: RunsOnState;
}

// "Start Claude ▾": one click starts the chosen agent; the caret picks which
// (CLI + model provider), and whether it shows as a chat or a terminal —
// replacing the selects that sat beside Start.
export function StartSplitButton({
  cli,
  provider,
  onStart,
  onChoose,
  transport,
  onChooseTransport,
  runsOn,
}: StartSplitButtonProps) {
  const inSandbox = runsOn.host === "vercel";
  const peer = runsOn.peers.find((p) => p.host === runsOn.host);
  // A peer runs the agents it lists; a sandbox only Claude.
  const unavailable = (c: AgentCli) =>
    inSandbox ? c !== "claude" : peer ? !peer.agentKinds.includes(c) : false;
  // A sandbox with no saved Claude login can only show a terminal, to sign in from.
  const chatBlocked = !useHasChat(cli) || Boolean(runsOn.chatBlock);
  const canChat = !chatBlocked;
  const shown = canChat ? (transport ?? defaultTransport(cli)) : "terminal";
  const name = agentLabel(cli, provider);
  return (
    <SplitButton
      primary
      menuLabel="Choose which agent to start"
      sections={[
        ...(runsOn.offered
          ? [
              {
                title: "Runs on",
                items: [
                  {
                    label: "This machine",
                    checked: runsOn.host === "local",
                    onSelect: () => runsOn.choose("local"),
                  },
                  ...(runsOn.sandboxOffered
                    ? [
                        {
                          label: "Vercel sandbox",
                          detail: "Clones the repo from GitHub",
                          checked: inSandbox,
                          onSelect: () => {
                            runsOn.choose("vercel");
                            // Only Claude runs in a sandbox.
                            if (cli !== "claude") onChoose("claude", provider);
                          },
                        },
                      ]
                    : []),
                  ...runsOn.peers.map((p) => ({
                    label: p.name,
                    detail: p.reason ?? "Another computer running trace",
                    checked: runsOn.host === p.host,
                    disabled: Boolean(p.reason),
                    onSelect: () => runsOn.choose(p.host),
                  })),
                ],
              },
            ]
          : []),
        {
          title: "Agent",
          items: AGENT_OPTIONS.map((o) => ({
            label: o.label,
            detail: unavailable(o.cli)
              ? inSandbox
                ? "Not available in a sandbox"
                : "Not available on this computer"
              : undefined,
            disabled: unavailable(o.cli),
            checked: isChosen(o, cli, provider),
            onSelect: () => onChoose(o.cli, o.provider),
          })),
        },
        {
          title: "Shows as",
          items: [
            {
              label: "Chat",
              detail: canChat ? undefined : (runsOn.chatBlock ?? `Not available for ${name}`),
              checked: shown === "chat",
              disabled: !canChat,
              onSelect: () => onChooseTransport("chat"),
            },
            {
              label: "Terminal",
              checked: shown === "terminal",
              onSelect: () => onChooseTransport("terminal"),
            },
          ],
        },
      ]}
    >
      <button type="button" className="btn primary" onClick={onStart}>
        <I.Play size={14} /> Start {name}
      </button>
    </SplitButton>
  );
}
