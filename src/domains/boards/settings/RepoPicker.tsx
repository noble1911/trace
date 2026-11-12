import { I } from "@/components/Icon";
import { basename } from "@/platform/paths";
import { type BoardRepos, toggleDefault, toggleRepo } from "./repoChoice";
import { useConfiguredRepos } from "./useBoardSetup";

interface RepoPickerProps {
  value: BoardRepos;
  onChange: (next: BoardRepos) => void;
  /** Labels the list for screen readers. */
  label: string;
}

// A board's repositories: every configured repo as a row that's picked or not, and,
// with more than one picked, which is the default. None picked is allowed: each card's
// repo is then decided as it always was (its mapping, the sole repo, or asked at Start).
export function RepoPicker({ value, onChange, label }: RepoPickerProps) {
  const { repos, loaded } = useConfiguredRepos();
  // A saved repo that's no longer configured still shows, so it can be unpicked.
  const rows = [...repos, ...value.repos.filter((r) => !repos.includes(r))];
  const several = value.repos.length > 1;

  if (loaded && rows.length === 0) {
    return <div className="bd-repo-empty">Add a repository in Settings → Repositories first.</div>;
  }
  return (
    <ul className="bd-repo-list" aria-label={label}>
      {rows.map((path) => {
        const picked = value.repos.includes(path);
        const isDefault = value.defaultRepo === path;
        return (
          <li key={path} className={picked ? "bd-repo-row picked" : "bd-repo-row"}>
            <button
              type="button"
              className="bd-repo-pick"
              aria-pressed={picked}
              onClick={() => onChange(toggleRepo(value, path))}
            >
              <span className="bd-repo-mark">{picked && <I.Check size={12} />}</span>
              <span className="bd-repo-name">{basename(path)}</span>
              <span className="bd-repo-path">{path}</span>
            </button>
            {picked && several && (
              <button
                type="button"
                className="btn xs bd-repo-default"
                aria-pressed={isDefault}
                onClick={() => onChange(toggleDefault(value, path))}
              >
                Default
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
