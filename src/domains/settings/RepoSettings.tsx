import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icon";
import { SplitButton } from "@/components/SplitButton";
import { RepoBrowser } from "@/domains/github/RepoBrowser";
import { useGitHubStore } from "@/domains/github/store";
import { useCloneRoot } from "@/domains/github/useCloneRoot";
import { MiddlePath } from "@/domains/repos/MiddlePath";
import { ConductorImportDialog, useConductorAvailable } from "./ConductorImport";
import { CONDUCTOR_IMPORT_WHAT } from "./ConductorImportButton";
import { RepoList } from "./RepoList";
import { SettingRow } from "./SettingRow";
import { SettingSection } from "./SettingSection";
import { TicketMappings } from "./TicketMappings";
import { useRepoSettings } from "./useRepoSettings";

// Settings → Repositories: the repos agents work in, how tickets pick one, and
// where GitHub clones go. Three sections, each always on the page, so nothing
// moves as repositories come and go.
export function RepoSettings() {
  const state = useRepoSettings();
  const [dialog, setDialog] = useState<"clone" | "conductor" | null>(null);
  const conductor = useConductorAvailable();
  const github = useGitHubStore((s) => s.status);
  const checkGitHub = useGitHubStore((s) => s.checkStatus);
  const logins = useMemo(() => (github?.accounts ?? []).map((a) => a.login), [github]);
  const mapped = useMemo(() => new Set(state.mappings.map((m) => m.repo)), [state.mappings]);

  useEffect(() => {
    if (!github) void checkGitHub();
  }, [github, checkGitHub]);

  const addFolder = () => void state.addFolder();
  const addSections = [
    {
      items: [
        { id: "folder", label: "From a folder…", onSelect: addFolder },
        ...(conductor
          ? [
              {
                id: "conductor",
                label: "Import from Conductor…",
                onSelect: () => setDialog("conductor"),
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <>
      {conductor && (
        <SettingSection title="Coming from Conductor">
          <SettingRow label="Import from Conductor" hint={CONDUCTOR_IMPORT_WHAT}>
            <button type="button" className="btn" onClick={() => setDialog("conductor")}>
              <I.Download size={14} /> Import…
            </button>
          </SettingRow>
        </SettingSection>
      )}
      <SettingSection
        title="Repositories"
        desc="The git repositories agents work in. Each agent gets its own worktree of one."
        actions={
          <>
            <button type="button" className="btn" onClick={() => setDialog("clone")}>
              <I.Download size={14} /> Clone from GitHub…
            </button>
            <SplitButton menuLabel="More ways to add" sections={addSections}>
              <button type="button" className="btn" onClick={addFolder}>
                <I.Plus size={14} /> Add repository…
              </button>
            </SplitButton>
          </>
        }
      >
        {state.repos.length > 0 ? (
          <RepoList
            repos={state.repos}
            details={state.details}
            logins={logins}
            mapped={mapped}
            onRemove={(path) => void state.remove(path)}
            onPatch={state.patchDetails}
          />
        ) : (
          state.loaded && (
            <div className="rs-empty">Add a local git repository, or clone one from GitHub.</div>
          )
        )}
      </SettingSection>

      <TicketMappings
        repos={state.repos}
        mappings={state.mappings}
        onChange={state.saveMappings}
        onAdd={state.addMapping}
      />

      <CloningSection />

      {dialog === "clone" && (
        <RepoBrowser
          onClose={() => {
            // Its last step may have saved the clone's setup.
            setDialog(null);
            state.reload();
          }}
          onCloned={() => state.reload()}
        />
      )}
      {dialog === "conductor" && (
        <ConductorImportDialog onClose={() => setDialog(null)} onImported={state.reload} />
      )}
    </>
  );
}

/** Where new GitHub clones go: one row, the folder shortened in the middle. */
function CloningSection() {
  const { root, change } = useCloneRoot();
  return (
    <SettingSection title="Cloning">
      <div className="setting-row rs-clone-row">
        <div className="setting-text">
          <div className="label">Clone folder</div>
          <div className="hint">New GitHub clones go here.</div>
        </div>
        <div className="control">
          <MiddlePath className="rs-clone-path" path={root ?? "…"} />
          <button type="button" className="btn" onClick={() => void change()}>
            Change…
          </button>
        </div>
      </div>
    </SettingSection>
  );
}
