import { useEffect, useMemo, useState } from "react";
import { toast } from "@/app/toast";
import { BusyLabel } from "@/components/BusyLabel";
import { I } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { GitHubSignIn } from "@/domains/github/GitHubSignIn";
import { useGitHubStore } from "@/domains/github/store";
import type { GhRepo } from "@/domains/github/types";
import { useSkillsStore } from "./store";

interface AddSourceDialogProps {
  onClose: () => void;
}

const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

const matches = (repo: GhRepo, q: string) =>
  repo.fullName.toLowerCase().includes(q) || (repo.description ?? "").toLowerCase().includes(q);

// Pick a GitHub repo of skills: one of yours or your organisations' (the repo browser's
// lists), or any other by its owner/name. trace reads it before adding it, so a repo with
// no skills is refused with the reason rather than added empty.
export function AddSourceDialog({ onClose }: AddSourceDialogProps) {
  const status = useGitHubStore((s) => s.status);
  const owners = useGitHubStore((s) => s.owners);
  const repos = useGitHubStore((s) => s.repos);
  const loadingOwner = useGitHubStore((s) => s.loadingOwner);
  const { checkStatus, loadOwners, loadRepos } = useGitHubStore.getState();
  const sources = useSkillsStore((s) => s.sources) ?? [];
  const add = useSkillsStore((s) => s.add);
  const login = status?.login ?? null;
  const [owner, setOwner] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const current = owner ?? login;

  useEffect(() => {
    if (!status) void checkStatus();
  }, [status, checkStatus]);
  useEffect(() => {
    if (login) void loadOwners(login);
  }, [login, loadOwners]);
  useEffect(() => {
    if (current) void loadRepos(current);
  }, [current, loadRepos]);

  const list = current ? repos[current] : undefined;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? []).filter((r) => !q || matches(r, q));
  }, [list, query]);
  const isSource = (repo: string) =>
    sources.some((s) => s.repo.toLowerCase() === repo.toLowerCase());

  const addRepo = async (repo: string) => {
    setAdding(repo);
    try {
      const view = await add(repo);
      const count =
        view.kind === "marketplace"
          ? `${view.plugins.length} plugin${view.plugins.length === 1 ? "" : "s"}`
          : `${view.skills.length} skill${view.skills.length === 1 ? "" : "s"}`;
      toast.success(`Added ${view.repo}: ${count}.`);
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setAdding(null);
    }
  };

  const body = () => {
    if (!login || status?.problem)
      return status ? <GitHubSignIn /> : <div className="gh-empty">Checking GitHub…</div>;
    const name = typed.trim();
    return (
      <>
        <div className="gh-toolbar">
          {owners.length > 1 && (
            <select
              aria-label="Owner"
              value={current ?? ""}
              onChange={(e) => setOwner(e.target.value)}
            >
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          <input
            type="search"
            aria-label="Search repositories"
            placeholder="Search repositories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="gh-list">
          {!list && loadingOwner === current && (
            <div className="gh-empty">Loading repositories…</div>
          )}
          {list && shown.length === 0 && (
            <div className="gh-empty">
              {query ? `No repositories match “${query}”.` : `${current} has no repositories.`}
            </div>
          )}
          {shown.map((r) => (
            <div key={r.fullName} className="gh-row">
              <div className="gh-row-main">
                <div className="gh-row-title">
                  <span className="gh-row-name">{r.name}</span>
                  {r.isPrivate && <span className="gh-flag">Private</span>}
                </div>
                {r.description && <div className="gh-row-desc">{r.description}</div>}
              </div>
              {isSource(r.fullName) ? (
                <span className="gh-row-local">
                  <I.Check size={14} /> Added
                </span>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={adding !== null}
                  onClick={() => void addRepo(r.fullName)}
                >
                  <BusyLabel busy={adding === r.fullName} idle="Add" working="Reading…" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="sk-typed">
          <input
            aria-label="Repository by name"
            placeholder="Or any repository: owner/name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && REPO_NAME.test(name) && !adding) void addRepo(name);
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={!REPO_NAME.test(name) || adding !== null}
            onClick={() => void addRepo(name)}
          >
            <BusyLabel busy={adding === name} idle="Add" working="Reading…" />
          </button>
        </div>
      </>
    );
  };

  return (
    <Modal title="Add skills from GitHub" onClose={onClose} className="gh-modal">
      {body()}
    </Modal>
  );
}
