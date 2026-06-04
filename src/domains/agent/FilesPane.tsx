import { type KeyboardEvent, useEffect, useState } from "react";
import { I } from "@/components/Icon";
import { type DiffSummary, type FileDiff, gitDiffFile, gitDiffSummary } from "@/ipc/diff";

// "Files" tab — git diff for a workspace (a board agent's worktree, or an
// exploratory session's repo root) vs origin/<default-branch>. Summary loads
// once; per-file hunks load on selection.
export function FilesPane({ workspaceId }: { workspaceId: string }) {
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setSelected(null);
    setFileDiff(null);
    setError(null);
    gitDiffSummary(workspaceId)
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setSelected(s.files[0]?.path ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!selected) {
      setFileDiff(null);
      return;
    }
    let cancelled = false;
    setLoadingFile(true);
    gitDiffFile(workspaceId, selected)
      .then((d) => {
        if (!cancelled) {
          setFileDiff(d);
          setLoadingFile(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoadingFile(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, selected]);

  if (error) return <Centered title="Couldn't load diff" hint={error} />;
  if (!summary)
    return <Centered title="Loading…" hint="Computing changes against the base branch." />;
  if (summary.files.length === 0)
    return <Centered title="No changes" hint={`Worktree matches ${summary.base}.`} />;

  return (
    <div className="tab-pane no-pad">
      <div className="files-pane">
        <FileTree files={summary.files} selected={selected} onSelect={setSelected} />
        <div className="diff-pane">
          {fileDiff ? <DiffView fd={fileDiff} /> : loadingFile ? <LoadingDiff /> : null}
        </div>
      </div>
    </div>
  );
}

interface FileTreeProps {
  files: { path: string; add: number; del: number }[];
  selected: string | null;
  onSelect: (path: string) => void;
}

function FileTree({ files, selected, onSelect }: FileTreeProps) {
  return (
    <div className="file-tree">
      <div className="group">Changed ({files.length})</div>
      {files.map((f) => (
        <FileNode
          key={f.path}
          file={f}
          active={selected === f.path}
          onSelect={() => onSelect(f.path)}
        />
      ))}
    </div>
  );
}

interface FileNodeProps {
  file: { path: string; add: number; del: number };
  active: boolean;
  onSelect: () => void;
}

function FileNode({ file, active, onSelect }: FileNodeProps) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") onSelect();
  };
  const name = file.path.split("/").pop() ?? file.path;
  return (
    // biome-ignore lint/a11y/useSemanticElements: in a scroll list of many nodes; div+role keeps the file-tree CSS layout intact, keyboard activation provided
    <div
      className={`node${active ? " active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKey}
      title={file.path}
    >
      <I.File size={12} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
      <span className="stat">
        <span className="add">+{file.add}</span>
        <span className="del">−{file.del}</span>
      </span>
    </div>
  );
}

function DiffView({ fd }: { fd: FileDiff }) {
  return (
    <>
      <div className="diff-head">
        <span className="path">{fd.path}</span>
        <span className="stat">
          <span style={{ color: "var(--c-done)" }}>+{fd.add}</span>{" "}
          <span style={{ color: "var(--c-danger)" }}>−{fd.del}</span>
        </span>
      </div>
      {fd.hunks.map((h) => (
        <div key={h.header}>
          <div className="diff-hunk">{h.header}</div>
          {h.lines.map((l) => (
            <div
              key={`${l.kind}:${l.oldNo ?? "_"}:${l.newNo ?? "_"}`}
              className={`diff-line ${l.kind}`}
            >
              <div className="ln">{l.oldNo ?? ""}</div>
              <div className="ln">{l.newNo ?? ""}</div>
              <div className="content">{l.text}</div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function LoadingDiff() {
  return (
    <div
      style={{ padding: 20, color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}
    >
      Loading file diff…
    </div>
  );
}

function Centered({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div className="inner">
        <div className="title">{title}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  );
}
