import { useState } from "react";
import {
  DEFAULT_KICKOFF_PROMPT,
  kickoffPromptRaw,
  setKickoffPrompt,
} from "@/domains/agent/defaults";
import { SettingRow } from "./SettingRow";
import { SettingSection } from "./SettingSection";

// Settings → Prompts: the brief a ticket's agent starts with. Saved prompts sit
// beside it on the same tab.
export function KickoffPromptSettings() {
  const [kickoff, setKickoff] = useState(kickoffPromptRaw);
  const choose = (next: string) => {
    setKickoff(next);
    setKickoffPrompt(next);
  };

  return (
    <SettingSection title="Kickoff prompt">
      <SettingRow
        label="Starting a ticket's agent"
        hint={
          <>
            Sent to the agent when you start it from the board (Start on a card or, with auto-start
            on, dragging to In&nbsp;Progress). Placeholders: <code>{"{tracker}"}</code> (Jira,
            Pylon, trace board), <code>{"{key}"}</code>, <code>{"{summary}"}</code>,{" "}
            <code>{"{description}"}</code>, <code>{"{comments}"}</code> (the ticket's discussion
            thread, fetched at launch), <code>{"{type}"}</code> (its issue or card type),{" "}
            <code>{"{board}"}</code> (its board's name). Blank uses the default. A board's own
            prompt (its ⋯ → Board settings…) replaces this one for its tickets.
          </>
        }
        block
      >
        <textarea
          aria-label="Kickoff prompt"
          rows={4}
          placeholder={DEFAULT_KICKOFF_PROMPT}
          value={kickoff}
          onChange={(e) => choose(e.target.value)}
        />
      </SettingRow>
    </SettingSection>
  );
}
