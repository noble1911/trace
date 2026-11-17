import { useEffect, useState } from "react";
import { toast } from "@/app/toast";
import { AddSourceDialog } from "./AddSourceDialog";
import { SourceSection } from "./SourceSection";
import { useSkillsStore } from "./store";

// Integrations → Skills: GitHub repos of Claude Code skills, each a section of what it
// holds. Any repo can be one: a team's plugin marketplace, or plain SKILL.md folders.
// Every source is read again when the tab opens, so new skills show without a refresh.
export function SkillsTab() {
  const sources = useSkillsStore((s) => s.sources);
  const load = useSkillsStore((s) => s.load);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    load().catch((e) => toast.error(`Couldn't load skill sources: ${e}`));
  }, [load]);

  return (
    <div className="ig-wrap">
      <div className="mcp-head">
        <div className="ig-note">
          Skills teach Claude how your team does things. Add a GitHub repository of them to see
          what's inside; each skill says, in its own words, what it's for.
        </div>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          Add from GitHub…
        </button>
      </div>
      {sources === null && <div className="ig-note">Loading…</div>}
      {sources?.length === 0 && (
        <div className="sk-empty">
          No skill sources yet. Add a repository of skills from GitHub to see what it holds.
        </div>
      )}
      {sources?.map((s) => (
        <SourceSection key={s.repo} source={s} />
      ))}
      {adding && <AddSourceDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
