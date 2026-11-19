import { useCallback, useEffect, useMemo, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { listReleases, type Release, type UpdateInfo } from "@/ipc/update";
import { formatReleaseDate, initialCount, releaseMark, sortReleases } from "./releaseNotes";
import { SettingSection } from "./SettingSection";

interface ChangelogProps {
  /** The running version ("0.16.1"); empty until known. */
  current: string;
  /** The update the check found, if any. */
  update: UpdateInfo | null;
}

// Settings → About's changelog: every release's notes, newest first, from GitHub.
// Releases newer than the one you run are marked New, so updating across several
// versions shows all of what changed, not only the newest's notes (which is all
// the update feed carries). Older releases fold behind "Show older releases".
export function Changelog({ current, update }: ChangelogProps) {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    setError(null);
    listReleases()
      .then((list) => setReleases(sortReleases(list)))
      .catch((err: unknown) => setError(String(err)));
  }, []);
  useEffect(load, [load]);

  // The check found a release published since the list loaded: load it again.
  const updateVersion = update?.version;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a newly found version reloads
  useEffect(() => {
    if (updateVersion && releases && !releases.some((r) => r.version === updateVersion)) load();
  }, [updateVersion]);

  const shown = useMemo(() => {
    if (!releases) return [];
    return showAll ? releases : releases.slice(0, initialCount(releases, current));
  }, [releases, showAll, current]);
  const hidden = (releases?.length ?? 0) - shown.length;

  return (
    <SettingSection title="Changelog" desc="What changed in each release of trace, newest first.">
      {error ? (
        <>
          {update?.notes && (
            <ReleaseEntry
              release={{
                version: update.version,
                notes: update.notes,
                publishedAt: null,
                url: null,
              }}
              current={current}
            />
          )}
          <div className="changelog-empty">
            <span>Couldn't load the changelog from GitHub. {error}</span>
            <button type="button" className="btn sm" onClick={load}>
              Try again
            </button>
          </div>
        </>
      ) : !releases ? (
        <div className="changelog-empty">Loading releases…</div>
      ) : releases.length === 0 ? (
        <div className="changelog-empty">No releases have been published yet.</div>
      ) : (
        <div className="changelog">
          {shown.map((r) => (
            <ReleaseEntry key={r.version} release={r} current={current} />
          ))}
          {hidden > 0 && (
            <button type="button" className="link-btn" onClick={() => setShowAll(true)}>
              Show {hidden} older {hidden === 1 ? "release" : "releases"}
            </button>
          )}
        </div>
      )}
    </SettingSection>
  );
}

function ReleaseEntry({ release, current }: { release: Release; current: string }) {
  const mark = releaseMark(release.version, current);
  const date = formatReleaseDate(release.publishedAt);
  return (
    <article className="changelog-entry">
      <header className="changelog-head">
        <span className="changelog-version">v{release.version}</span>
        {mark && <span className="changelog-mark">{mark === "new" ? "New" : "Installed"}</span>}
        {date && <span className="changelog-date">{date}</span>}
      </header>
      {release.notes.trim() ? (
        <Markdown text={release.notes} />
      ) : (
        <p className="changelog-none">No notes for this release.</p>
      )}
    </article>
  );
}
