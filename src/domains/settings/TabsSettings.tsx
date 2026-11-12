import { Fragment } from "react";
import { Switch } from "@/components/Switch";
import { isTabOn, OPTIONAL_TABS, useTabSettings } from "@/domains/panes/tabSettings";
import { SettingRow } from "./SettingRow";
import { SettingSection } from "./SettingSection";

// Settings → Layout → Tabs: the workspace tabs that come and go beside an agent, what
// each is for, and a switch for each. Off, a tab never shows (nor in the pane menu),
// and the agent tools that fill it aren't offered to agents. Tool ids are set in mono.
export function TabsSettings() {
  const off = useTabSettings((s) => s.off);
  const setOn = useTabSettings((s) => s.setOn);
  const autoClose = useTabSettings((s) => s.autoCloseSubagents);
  const setAutoClose = useTabSettings((s) => s.setAutoCloseSubagents);
  return (
    <>
      <OptionalTabs off={off} setOn={setOn} />
      <SettingSection
        title="Subagent tabs"
        desc="An agent's subagents each get a tab beside it while they run."
      >
        <SettingRow
          label="Close idle subagent tabs"
          hint="A finished subagent's tab closes 5 minutes after it ends, unless you've opened it. Its card in the chat brings it back."
        >
          <Switch on={autoClose} onChange={setAutoClose} label="Close idle subagent tabs" />
        </SettingRow>
      </SettingSection>
    </>
  );
}

function OptionalTabs({ off, setOn }: { off: string[]; setOn: (id: string, on: boolean) => void }) {
  return (
    <SettingSection
      title="Tabs"
      desc="Beside an agent's chat, these tabs show only when there's something in them. Open one yourself from a pane's ⋯ menu. Turn one off to never see it; agents then aren't given the tool that fills it."
    >
      {OPTIONAL_TABS.map((tab) => {
        const on = isTabOn(off, tab.id);
        const hint =
          tab.tools.length > 0 ? (
            <>
              {tab.about} Agent {tab.tools.length === 1 ? "tool" : "tools"}:{" "}
              {tab.tools.map((t, i) => (
                <Fragment key={t}>
                  {i > 0 && ", "}
                  <code>{t}</code>
                </Fragment>
              ))}
              .
            </>
          ) : (
            tab.about
          );
        return (
          <SettingRow key={tab.id} label={tab.label} hint={hint}>
            <Switch on={on} onChange={(next) => setOn(tab.id, next)} label={`Show ${tab.label}`} />
          </SettingRow>
        );
      })}
    </SettingSection>
  );
}
