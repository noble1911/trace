import { useState } from "react";
import { toast } from "@/app/toast";
import { BusyLabel } from "@/components/BusyLabel";
import { InlineConfirm } from "@/components/InlineConfirm";
import { MiddlePath } from "@/domains/repos/MiddlePath";
import { type InstallScope, installPlugin, uninstallPlugin, updatePlugin } from "@/ipc/skills";
import { basename } from "@/platform/paths";
import { isNewer, type Place, placesFor } from "./places";
import { useSkillsStore } from "./store";

interface InstallPlacesProps {
  /** The source's repo, `owner/name`. */
  source: string;
  plugin: string;
  /** The marketplace's own name: the plugin's id is `<plugin>@<this>`. */
  marketplace: string;
  /** The marketplace's version of it, as read from GitHub. */
  latest: string | null;
}

/** What a busy row is doing, so only its button says the verb. */
interface Busy {
  place: string;
  what: "install-local" | "install-project" | "install-user" | "update" | "remove";
}

const placeKey = (p: Place) => (p.kind === "you" ? "you" : p.repo);

/** How a place's install reads, in plain words. */
function status(p: Place): string {
  const v = p.installed?.version ? ` · v${p.installed.version}` : "";
  if (p.kind === "you") {
    return p.installed ? `Installed${v}` : "Every session and agent, in every repository";
  }
  if (p.installed?.scope === "local") return `Just me${v}`;
  if (p.committed) return "Comes with the repository, for everyone";
  if (p.installed) return `For everyone${v} · shared once .claude/settings.json is merged`;
  return "Not installed";
}

// A plugin's install list in its dialog (docs/SKILLS_PLAN.md, stage 2): everywhere
// for you, then each of trace's repositories, for everyone on it or just you. Claude
// Code does each install; the list is read back from it after every change.
export function InstallPlaces({ source, plugin, marketplace, latest }: InstallPlacesProps) {
  const installs = useSkillsStore((s) => s.installs);
  const error = useSkillsStore((s) => s.installsError);
  const [busy, setBusy] = useState<Busy | null>(null);
  const id = `${plugin}@${marketplace}`;

  const run = async (b: Busy, work: () => Promise<string>, done: string, failed: string) => {
    setBusy(b);
    try {
      await work();
      toast.success(done);
    } catch (e) {
      toast.error(`${failed}: ${String(e)}`);
    } finally {
      await useSkillsStore.getState().loadInstalls();
      setBusy(null);
    }
  };

  const install = (p: Place, scope: InstallScope) => {
    const repo = p.kind === "repo" ? p.repo : null;
    const where = repo ? ` in ${basename(repo)}` : " for you";
    void run(
      { place: placeKey(p), what: `install-${scope}` as Busy["what"] },
      () => installPlugin(source, plugin, scope, repo),
      `Installed ${plugin}${where}. Agents started from now on have it.`,
      `Couldn't install ${plugin}`
    );
  };

  const isBusy = (p: Place, what: Busy["what"]) =>
    busy?.place === placeKey(p) && busy.what === what;

  const actions = (p: Place) => {
    const repo = p.kind === "repo" ? p.repo : null;
    const inst = p.installed;
    if (inst && inst.scope !== "other") {
      const where = repo ? ` from ${basename(repo)}` : " for you";
      return (
        <>
          {isNewer(latest, inst.version) && (
            <button
              type="button"
              className="btn sm"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  { place: placeKey(p), what: "update" },
                  () => updatePlugin(id, inst.scope, repo),
                  `Updated ${plugin} to v${latest}. Restart an agent to give it the new version.`,
                  `Couldn't update ${plugin}`
                )
              }
            >
              <BusyLabel
                busy={isBusy(p, "update")}
                idle={`Update to v${latest}`}
                working="Updating…"
              />
            </button>
          )}
          <InlineConfirm
            label={<BusyLabel busy={isBusy(p, "remove")} idle="Remove" working="Removing…" />}
            message={`Remove ${plugin}${where}?`}
            confirmLabel="Remove"
            size="sm"
            className="btn sm"
            disabled={busy !== null}
            onConfirm={() =>
              void run(
                { place: placeKey(p), what: "remove" },
                () => uninstallPlugin(id, inst.scope, repo),
                `Removed ${plugin}${where}.`,
                `Couldn't remove ${plugin}`
              )
            }
          />
        </>
      );
    }
    if (p.kind === "repo" && p.committed) return null;
    if (p.kind === "you") {
      return (
        <button
          type="button"
          className="btn sm"
          disabled={busy !== null}
          onClick={() => install(p, "user")}
        >
          <BusyLabel busy={isBusy(p, "install-user")} idle="Install" working="Installing…" />
        </button>
      );
    }
    return (
      <>
        <button
          type="button"
          className="btn sm"
          disabled={busy !== null}
          onClick={() => install(p, "local")}
        >
          <BusyLabel busy={isBusy(p, "install-local")} idle="Just me" working="Installing…" />
        </button>
        <button
          type="button"
          className="btn sm"
          title="Writes the repository's .claude/settings.json: commit and merge it to share it"
          disabled={busy !== null}
          onClick={() => install(p, "project")}
        >
          <BusyLabel
            busy={isBusy(p, "install-project")}
            idle="For everyone"
            working="Installing…"
          />
        </button>
      </>
    );
  };

  return (
    <section className="sk-where">
      <div className="sk-section-label">Install</div>
      {error && <div className="sk-error">Couldn't ask Claude Code what's installed: {error}</div>}
      {!installs && !error && <div className="ig-note">Asking Claude Code what's installed…</div>}
      {installs && (
        <ul className="sk-places">
          {placesFor(id, installs).map((p) => (
            <li key={placeKey(p)} className="sk-place">
              <div className="sk-place-what">
                <div className="sk-place-name">
                  {p.kind === "you" ? "Everywhere, just for me" : basename(p.repo)}
                </div>
                {p.kind === "repo" && <MiddlePath path={p.repo} className="sk-place-path" />}
                <div className="sk-place-status">{status(p)}</div>
              </div>
              <div className="sk-place-actions">{actions(p)}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="ig-note">
        Agents started from now on get its skills; restart a running one to give it them. Only
        Claude agents load plugins, not Codex.
      </div>
    </section>
  );
}
