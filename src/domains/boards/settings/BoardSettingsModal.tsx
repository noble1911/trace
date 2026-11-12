import { type FormEvent, useEffect, useState } from "react";
import { toast } from "@/app/toast";
import { BusyLabel } from "@/components/BusyLabel";
import { Modal } from "@/components/Modal";
import { kickoffPromptTemplate } from "@/domains/agent/defaults";
import { useIssuesStore } from "@/domains/issues/store";
import type { BoardSettings } from "@/ipc/boardSettings";
import type { SettingsDialog } from "../uiStore";
import { CardTypesEditor } from "./CardTypesEditor";
import { RepoPicker } from "./RepoPicker";
import { DEFAULT_BOARD_SETTINGS, useBoardSetup } from "./store";

const PLACEHOLDERS = ["{key}", "{summary}", "{description}", "{comments}", "{type}", "{board}"];

const reason = (err: unknown) => String(err).replace(/^Error:\s*/i, "");

// "Board settings…" from any board's ⋯: the kickoff prompt its cards' agents start with
// and the repos they start in, saved together on Save; on a custom board, its card types
// too, each change applied as it's made. Columns are edited on the board itself.
export function BoardSettingsModal({
  dialog,
  onClose,
}: {
  dialog: SettingsDialog;
  onClose: () => void;
}) {
  const { boardKey, draft } = dialog;
  const option = useIssuesStore((s) => s.boards.find((b) => b.key === boardKey));
  const loadSettings = useBoardSetup((s) => s.loadSettings);
  const [initial, setInitial] = useState<BoardSettings | null>(draft ?? null);

  // Read fresh when it opens; unreadable settings start from the defaults, said once.
  useEffect(() => {
    if (draft) return;
    let live = true;
    void loadSettings(boardKey, true).then((loaded) => {
      if (!live) return;
      if (!loaded) {
        const why = useBoardSetup.getState().settingsError[boardKey] ?? "unknown error";
        toast.error(`Couldn't read this board's settings: ${why}`);
      }
      setInitial(loaded ?? DEFAULT_BOARD_SETTINGS);
    });
    return () => {
      live = false;
    };
  }, [boardKey, draft, loadSettings]);

  const title = option ? `${option.name} settings` : "Board settings";
  if (!initial) {
    return (
      <Modal title={title} onClose={onClose} className="bd-setup-modal">
        <div className="bd-repo-empty">Loading…</div>
      </Modal>
    );
  }
  return (
    <SettingsForm
      title={title}
      boardKey={boardKey}
      customId={option?.provider === "custom" ? option.boardId : null}
      initial={initial}
      onClose={onClose}
    />
  );
}

interface SettingsFormProps {
  title: string;
  boardKey: string;
  /** The board's id when it's a custom one (it has card types). */
  customId: string | null;
  initial: BoardSettings;
  onClose: () => void;
}

function SettingsForm({ title, boardKey, customId, initial, onClose }: SettingsFormProps) {
  const [prompt, setPrompt] = useState(initial.kickoffPrompt ?? "");
  const [repos, setRepos] = useState({ repos: initial.repos, defaultRepo: initial.defaultRepo });
  const [busy, setBusy] = useState(false);
  const saveSettings = useBoardSetup((s) => s.saveSettings);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await saveSettings(boardKey, { kickoffPrompt: prompt.trim() || null, ...repos });
      onClose();
    } catch (err) {
      toast.error(`Couldn't save the board's settings: ${reason(err)}`);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      className="bd-setup-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="bd-settings-form"
            className="btn primary"
            disabled={busy}
            aria-busy={busy}
          >
            <BusyLabel busy={busy} idle="Save" working="Saving…" />
          </button>
        </>
      }
    >
      <form id="bd-settings-form" className="bd-setup-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="bd-settings-prompt">Kickoff prompt</label>
          <textarea
            id="bd-settings-prompt"
            className="bd-prompt"
            value={prompt}
            placeholder={kickoffPromptTemplate()}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <span className="hint">
            What its tickets' agents start with. Placeholders:{" "}
            {PLACEHOLDERS.map((p, i) => (
              <span key={p}>
                {i > 0 && " "}
                <code>{p}</code>
              </span>
            ))}
            . Blank uses the kickoff prompt from Settings.
          </span>
        </div>
        <div className="field">
          <span className="bd-field-label">Repositories</span>
          <RepoPicker label="Repositories" value={repos} onChange={setRepos} />
          <span className="hint">
            Tickets with no repository of their own start here. None: decided as on any board.
            Several with no default: Start asks.
          </span>
        </div>
      </form>
      {customId && (
        <div className="field">
          <span className="bd-field-label">Card types</span>
          <CardTypesEditor boardId={customId} />
          <span className="hint">
            A type's own prompt replaces the board's for its cards. Changes here apply at once.
          </span>
        </div>
      )}
    </Modal>
  );
}
