import { I } from "@/components/Icon";

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

interface StartPromptProps {
  onStart: () => void;
  onStartFresh: () => void;
  repos: string[];
  repoChoice: string;
  onRepoChange: (path: string) => void;
  /** Display name of the agent about to launch (e.g. "claude", "kimi · wafer"). */
  agentName: string;
  /** The harness CLI ("claude" | "codex") — names the TUI the user will get. */
  cliName: string;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Overlay shown over the (mounted-but-idle) terminal before a session starts:
// pick the repo, then start. Disabled until at least one repo is configured.
export function StartPrompt({
  onStart,
  onStartFresh,
  repos,
  repoChoice,
  onRepoChange,
  agentName,
  cliName,
}: StartPromptProps) {
  const noRepos = repos.length === 0;
  return (
    <div className="empty-state">
      <div className="inner">
        <span className="ic">
          <I.Bolt size={28} />
        </span>
        <div className="title">Start an interactive {capitalize(agentName)} session</div>
        <div className="hint">
          The agent runs in an isolated git worktree under the repo you pick. You'll get the full{" "}
          {cliName} TUI right here.
        </div>
        {noRepos ? (
          <div className="hint" style={{ color: "var(--c-warn)" }}>
            Add a repository in Settings first.
          </div>
        ) : (
          <label className="field" style={{ width: 280, marginTop: 4 }}>
            <span className="field-label">Repository</span>
            <select value={repoChoice} onChange={(e) => onRepoChange(e.target.value)}>
              {repos.map((r) => (
                <option key={r} value={r}>
                  {basename(r)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className="btn primary"
          style={{ marginTop: 6 }}
          onClick={onStart}
          disabled={noRepos}
        >
          <I.Bolt size={13} /> Start {agentName}
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={onStartFresh}
          title="Forget the saved conversation and begin a new one — use this if you see “session not found”."
        >
          Start fresh conversation
        </button>
      </div>
    </div>
  );
}
