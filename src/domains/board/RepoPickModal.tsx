import { toast } from "@/app/toast";
import { I } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { boardRepos, pickerRepos } from "@/domains/boards/settings/repoChoice";
import { useConfiguredRepos, useFreshBoardSettings } from "@/domains/boards/settings/useBoardSetup";
import { setIssueRepo } from "@/ipc/repos";
import { basename } from "@/platform/paths";
import { useBoardStore } from "./store";

// Shown when a board kickoff needs a repo and none can be inferred (multiple
// repos, no assignment, no learned project default). Picking assigns the repo,
// teaches the project default, and retries the kickoff — all without leaving
// the board. A board with repos of its own (Board settings) offers only those,
// its default first and focused.
export function RepoPickModal({ issueKey }: { issueKey: string }) {
  const closeRepoPick = useBoardStore((s) => s.closeRepoPick);
  const kickoff = useBoardStore((s) => s.kickoff);
  const boardKey = useBoardStore((s) => s.boardKey);
  // Read fresh, and nothing offered until both have answered: the board's repos narrow
  // the list, so offering every repo first would offer ones the board doesn't use.
  const { settings, loaded: settingsLoaded } = useFreshBoardSettings(boardKey);
  const { repos: configured, loaded: reposLoaded } = useConfiguredRepos();
  const ready = settingsLoaded && reposLoaded;
  const { repos, preselected } = pickerRepos(settings, configured);
  const fromBoard = boardRepos(settings, configured).length > 0;

  const pick = async (path: string) => {
    try {
      await setIssueRepo(issueKey, path);
      closeRepoPick();
      kickoff(issueKey);
    } catch (err) {
      toast.error(`Couldn't set ${issueKey}'s repository: ${String(err)}`);
    }
  };

  return (
    <Modal title={`Where does ${issueKey} live?`} onClose={closeRepoPick}>
      {/* Both are local reads, well under a second: nothing is drawn until they answer. */}
      {ready && (
        <>
          <div className="hint repo-pick-hint">
            {fromBoard
              ? "Pick one of this board's repositories for this ticket. Board settings (its ⋯) can set a default."
              : "Pick the repository for this ticket. To resolve similar tickets automatically, add a ticket mapping in Settings → Repositories."}
          </div>
          <div className="repo-pick-list">
            {repos.map((path) => (
              <button
                type="button"
                key={path}
                className="repo-pick-row"
                // biome-ignore lint/a11y/noAutofocus: the board's default is the likely pick
                autoFocus={path === preselected}
                onClick={() => void pick(path)}
              >
                <I.Code size={14} />
                <span className="name">{basename(path)}</span>
                <span className="path">{path}</span>
                {path === preselected && <span className="repo-pick-default">Default</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
