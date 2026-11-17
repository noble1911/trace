import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { InlineConfirm } from "@/components/InlineConfirm";
import type { Plugin, Skill, SourceRecord } from "@/ipc/skills";
import { SkillsDialog } from "./SkillsDialog";
import { sourceState, useSkillsStore } from "./store";

interface Shown {
  title: string;
  about: string | null;
  version?: string | null;
  skills: Skill[];
  empty?: string;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// One source: its repo, what kind it is, and a card per plugin (a marketplace) or per
// skill (folders). A card opens what it holds. Removing a source only stops listing it.
export function SourceSection({ source }: { source: SourceRecord }) {
  const state = useSkillsStore((s) => sourceState(s.read, source.repo));
  const { refresh, remove } = useSkillsStore.getState();
  const [shown, setShown] = useState<Shown | null>(null);
  const view = state.status === "ready" ? state.view : null;

  const pluginCard = (p: Plugin) => (
    <button
      key={p.name}
      type="button"
      className="ig-card sk-card"
      onClick={() =>
        setShown({
          title: p.name,
          about: p.description,
          version: p.version,
          skills: p.skills,
          empty: p.folder ? "No skills in it yet." : "It lives in another repository.",
        })
      }
    >
      <div className="ig-name">
        {p.name}
        {p.version && <span className="sk-version">v{p.version}</span>}
      </div>
      {p.description && <div className="ig-desc sk-clamp">{p.description}</div>}
      <div className="sk-card-foot">
        {p.folder ? plural(p.skills.length, "skill") : "From another repository"}
      </div>
    </button>
  );
  const skillCard = (s: Skill) => (
    <button
      key={s.folder}
      type="button"
      className="ig-card sk-card"
      onClick={() => setShown({ title: s.name, about: null, skills: [s] })}
    >
      <div className="ig-name">{s.name}</div>
      {s.description && <div className="ig-desc sk-clamp">{s.description}</div>}
    </button>
  );

  const kind = !view
    ? null
    : view.kind === "marketplace"
      ? `Plugin marketplace · ${plural(view.plugins.length, "plugin")}`
      : `Skill folders · ${plural(view.skills.length, "skill")}`;

  return (
    <section className="ig-section">
      <div className="sk-source-head">
        <div className="sk-source-title">
          <h2>{view?.repo ?? source.repo}</h2>
          {kind && <div className="ig-note">{kind}</div>}
          {view?.description && <div className="ig-note">{view.description}</div>}
        </div>
        <div className="sk-source-actions">
          <IconButton
            label="Read again"
            size="sm"
            className="ghost"
            onClick={() => void refresh(source.repo)}
          >
            <I.Refresh size={14} />
          </IconButton>
          <IconButton
            label="Open on GitHub"
            size="sm"
            className="ghost"
            onClick={() => void openUrl(view?.url ?? `https://github.com/${source.repo}`)}
          >
            <I.External size={14} />
          </IconButton>
          <InlineConfirm
            label="Remove"
            message={`Stop listing ${source.repo}? Skills installed from it stay installed.`}
            confirmLabel="Remove"
            size="sm"
            onConfirm={() => void remove(source.repo).catch((e) => toast.error(String(e)))}
          />
        </div>
      </div>
      {state.status === "loading" && <div className="ig-note">Reading it from GitHub…</div>}
      {state.status === "error" && <div className="sk-error">{state.error}</div>}
      {view && (
        <div className="ig-grid">
          {view.kind === "marketplace" ? view.plugins.map(pluginCard) : view.skills.map(skillCard)}
        </div>
      )}
      {view?.truncated && (
        <div className="ig-note">
          It has more skills than trace lists; the first ones are shown.
        </div>
      )}
      {shown && <SkillsDialog {...shown} onClose={() => setShown(null)} />}
    </section>
  );
}
