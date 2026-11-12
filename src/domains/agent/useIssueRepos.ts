import { useEffect, useState } from "react";
import { toast } from "@/app/toast";
import { issueBoardKey } from "@/domains/boards/settings/briefSource";
import { startPromptRepos } from "@/domains/boards/settings/repoChoice";
import { useBoardSetup } from "@/domains/boards/settings/store";
import { issueRepo, listRepos } from "@/ipc/repos";

/**
 * The ticket Start prompt's repos and its pick: the ticket's saved repo, else what its
 * board's settings say (only the board's repos, its default first), else every
 * configured repo and the first. A board whose settings can't be read offers them all.
 */
export function useIssueRepos(issueKey: string): {
  repos: string[];
  repoChoice: string;
  setRepoChoice: (path: string) => void;
} {
  const [repos, setRepos] = useState<string[]>([]);
  const [repoChoice, setRepoChoice] = useState("");

  useEffect(() => {
    let cancelled = false;
    const boardKey = issueBoardKey(issueKey);
    const board = boardKey ? useBoardSetup.getState().loadSettings(boardKey) : null;
    Promise.all([listRepos(), issueRepo(issueKey), board])
      .then(([all, assigned, settings]) => {
        if (cancelled) return;
        const offered = startPromptRepos(settings, all, assigned);
        setRepos(offered.repos);
        setRepoChoice(offered.choice);
      })
      .catch((err) => toast.error(`Couldn't load your repositories: ${String(err)}`));
    return () => {
      cancelled = true;
    };
  }, [issueKey]);

  return { repos, repoChoice, setRepoChoice };
}
