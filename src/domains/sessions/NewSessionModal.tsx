import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/app/toast";
import { BusyLabel } from "@/components/BusyLabel";
import { I, ICON_SIZE } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { modelLockReason } from "@/domains/agentChat/agentOptionsFormat";
import { defaultTransport, useHasChat } from "@/domains/agentChat/transport";
import { usePeerChoices } from "@/domains/peers/usePeerChoices";
import { useVercelStatus } from "@/domains/vercel/store";
import type { AgentCli, AgentProvider, Transport } from "@/ipc/agent";
import { listRepos } from "@/ipc/repos";
import { basename } from "@/platform/paths";
import { useSandboxRepos } from "./hooks/useSandboxRepos";
import { NewSessionMore } from "./NewSessionMore";
import { NewSessionWhere } from "./NewSessionWhere";
import { lastSessionStart, rememberSessionStart } from "./sessionDefaults";
import { sandboxRepoNote } from "./sessionHost";
import { titleFromPrompt } from "./titleFromPrompt";
import type { SessionHostId } from "./types";

/** What the dialog asks for, as one object: it has outgrown a positional list. */
export interface NewSessionRequest {
  title: string;
  /** The task to send as the agent's first message. Empty leaves it idle, as before. */
  prompt: string;
  cli: AgentCli;
  repo: string | null;
  provider: AgentProvider;
  folder: string | null;
  transport: Transport;
  host: SessionHostId | null;
  /** Unset leaves the model to Settings and the CLI's own default. */
  model: string | null;
  mode: string | null;
}

interface NewSessionModalProps {
  defaultCli: AgentCli;
  defaultProvider: AgentProvider;
  onClose: () => void;
  onCreate: (request: NewSessionRequest) => void;
}

// Values of the "Runs in" picker that aren't a repo's path (those are always absolute).
const SCRATCH = "scratch";
const FOLDER = "folder";
const CHOOSE_FOLDER = "choose";
const isRepoPlace = (place: string) => place !== SCRATCH && place !== FOLDER;

// A session starts from the task you want done: type it, press Start, and the agent
// is created and handed it as its first message. Haiku names the session from that
// task (`titleFromPrompt`) unless you type a name under it. The choices that change where the
// work happens sit under it, opened on whatever was used last
// (`sessionDefaults`); the rest are behind More options. An empty task still works
// and behaves as it always did: the session is created and waits at its prompt.
export function NewSessionModal({
  defaultCli,
  defaultProvider,
  onClose,
  onCreate,
}: NewSessionModalProps) {
  const [last] = useState(lastSessionStart);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const vercel = useVercelStatus();
  const { choices: peers } = usePeerChoices();
  const [hostPick, setHostPick] = useState<SessionHostId | "local">(last.host ?? "local");
  // A peer that's gone away or unpaired meanwhile, or Vercel disconnected: back to this computer.
  const peer = peers.find((p) => p.host === hostPick && !p.reason);
  const host: SessionHostId | null =
    hostPick === "vercel" && vercel ? "vercel" : peer ? peer.host : null;
  const [pickedCli, setCli] = useState<AgentCli>(defaultCli);
  // A sandbox's image has Claude Code, not Codex; a peer runs what it lists.
  const cli: AgentCli =
    host === "vercel"
      ? "claude"
      : peer && !peer.agentKinds.includes(pickedCli)
        ? "claude"
        : pickedCli;
  const [provider, setProvider] = useState<AgentProvider>(defaultProvider);
  const [transport, setTransport] = useState<Transport>(
    () => last.transport ?? defaultTransport(defaultCli)
  );
  // A peer's server shows a terminal only, for now.
  const canChat = useHasChat(cli) && !peer;
  // A Vercel sandbox runs Claude as a chat too (`execution::sandbox::chat`), but
  // headless: with no Claude login saved for sandboxes, only a terminal has
  // somewhere to type /login, so that's what it gets.
  const needsLogin = host === "vercel" && !vercel?.claude;
  const shownAs: Transport = canChat && !needsLogin ? transport : "terminal";
  const [repos, setRepos] = useState<string[]>([]);
  const [place, setPlace] = useState(last.place ?? SCRATCH);
  const [folder, setFolder] = useState<string | null>(last.folder);
  const [model, setModel] = useState(last.model ?? "");
  const [mode, setMode] = useState(last.mode ?? "");
  // A sandbox clones the repo's GitHub origin, so only those repos are offered for one.
  const sandbox = useSandboxRepos(host === "vercel");
  const choices = peer ? peer.repos : host ? (sandbox?.usable ?? []) : repos;
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const modelLocked = modelLockReason(cli, provider);

  // Focus the task field on open (without the lint-flagged autoFocus attribute).
  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  // Load configured repos, keeping the one last used while it's still configured.
  useEffect(() => {
    let cancelled = false;
    listRepos()
      .then((all) => {
        if (cancelled) return;
        setRepos(all);
        setPlace((current) =>
          current === SCRATCH || current === FOLDER || all.includes(current)
            ? current
            : (all[0] ?? SCRATCH)
        );
      })
      .catch((err) => toast.error(`Couldn't load your repositories: ${String(err)}`));
    return () => {
      cancelled = true;
    };
  }, []);

  const choosePlace = async (next: string) => {
    if (next !== CHOOSE_FOLDER) {
      setPlace(next);
      return;
    }
    // A cancelled dialog leaves the current choice alone.
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder" });
    if (typeof picked !== "string") return;
    setFolder(picked);
    setPlace(FOLDER);
  };

  // A sandbox needs a GitHub repo and a peer one of its own: move off a folder, or a repo
  // it can't use, onto one it can.
  const firstUsable = choices[0];
  useEffect(() => {
    if (host && firstUsable && !choices.includes(place)) setPlace(firstUsable);
  }, [host, firstUsable, choices, place]);
  const canCreate = host ? choices.includes(place) : true;

  const submit = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    // Named before it's created: a folder session's directory is slugified from its
    // title then, and renaming it later doesn't move the folder.
    const named = title.trim() || (await titleFromPrompt(prompt)) || "Exploration";
    const isRepo = isRepoPlace(place);
    rememberSessionStart({
      place,
      folder,
      host,
      transport,
      model: modelLocked ? null : model,
      mode,
    });
    onCreate({
      title: named,
      prompt: prompt.trim(),
      cli,
      repo: isRepo ? place : null,
      provider,
      folder: place === FOLDER ? folder : null,
      transport: shownAs,
      host,
      model: modelLocked ? null : model || null,
      mode: mode || null,
    });
  };

  const note = peer
    ? `Runs in an isolated worktree of this repository on ${peer.name}, as a terminal.`
    : host
      ? sandboxRepoNote(
          sandbox && { usable: sandbox.usable, skipped: sandbox.skipped.map((r) => basename(r)) }
        )
      : place === SCRATCH
        ? "Runs in a new empty folder, which is deleted along with the session."
        : place === FOLDER
          ? "Runs directly in this folder. Without a worktree, there's no isolation or Files tab."
          : "Runs in an isolated worktree of the selected repository.";

  return (
    <Modal
      title="New session"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canCreate || busy}
            onClick={() => void submit()}
          >
            <BusyLabel busy={busy} idle="Start" working="Starting…" />
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">What should the agent do?</span>
        <textarea
          ref={promptRef}
          className="ns-task"
          placeholder="e.g. Fix the flaky auth test, then open a PR"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void submit();
          }}
        />
      </label>
      <label className="field">
        <span className="field-label">Name</span>
        <input
          className="field-input"
          type="text"
          placeholder="Named from the task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <NewSessionWhere
        host={host}
        choices={choices}
        sandboxKnown={Boolean(peer || sandbox)}
        peerName={peer?.name ?? null}
        agentKinds={peer?.agentKinds ?? null}
        place={place}
        onPlace={(next) => void choosePlace(next)}
        folder={folder}
        scratchValue={SCRATCH}
        folderValue={FOLDER}
        chooseValue={CHOOSE_FOLDER}
        cli={cli}
        onCli={setCli}
        model={model}
        onModel={setModel}
        modelLocked={modelLocked}
        mode={mode}
        onMode={setMode}
      />
      <button
        type="button"
        className="btn sm ns-more"
        aria-expanded={more}
        onClick={() => setMore((v) => !v)}
      >
        <I.Chevron size={ICON_SIZE.sm} />
        More options
      </button>
      {more && (
        <NewSessionMore
          peers={peers}
          showVercel={Boolean(vercel)}
          hostPick={hostPick}
          onHost={setHostPick}
          cli={cli}
          host={host}
          peerName={peer?.name ?? null}
          provider={provider}
          onProvider={setProvider}
          shownAs={shownAs}
          onTransport={setTransport}
          canChat={canChat}
          needsLogin={needsLogin}
        />
      )}
      <div className="field-note">{note}</div>
    </Modal>
  );
}
