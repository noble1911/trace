import { openUrl } from "@tauri-apps/plugin-opener";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import { useSessionsStore } from "@/domains/sessions/store";
import { buildCommands, type Command } from "./commands";
import type { NavId } from "./nav";
import { runSearch, type SearchHit } from "./search";

const GROUPS: { key: "issues" | "sessions" | "prs" | "chats"; label: string }[] = [
  { key: "issues", label: "Tickets" },
  { key: "sessions", label: "Sessions" },
  { key: "prs", label: "Pull requests" },
  { key: "chats", label: "Chats" },
];

/** A palette row: something to do (`Command`) or something found (`SearchHit`). */
type Row = { type: "command"; command: Command } | { type: "hit"; hit: SearchHit };

const COMMAND_GROUPS: { key: Command["group"]; label: string }[] = [
  { key: "needs", label: "Needs you" },
  { key: "action", label: "Actions" },
];

// The topbar palette: agents that need you and actions first, then search over
// issues, sessions, PRs and live chat output. ⌘K / ⌘/ focus it; a leading `>`
// shows actions only; arrows + Enter navigate; Esc closes.
export function SearchPalette({ onNav }: { onNav: (nav: NavId) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const openIssue = useBoardStore((s) => s.openIssue);
  const selectSession = useSessionsStore((s) => s.select);

  // Chat buffers can be large — debounce so we search settled input, not
  // every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const commandsOnly = debounced.trimStart().startsWith(">");
  const term = commandsOnly ? debounced.trimStart().slice(1) : debounced;
  // Commands read live state, so rebuild them whenever the palette opens too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` is the refresh trigger
  const commands = useMemo(() => buildCommands(term, onNav), [term, onNav, open]);
  const results = useMemo(
    () => (commandsOnly ? runSearch("") : runSearch(term)),
    [term, commandsOnly]
  );
  const flat = useMemo<Row[]>(
    () => [
      ...COMMAND_GROUPS.flatMap((g) =>
        commands
          .filter((c) => c.group === g.key)
          .map((command): Row => ({ type: "command", command }))
      ),
      ...GROUPS.flatMap((g) => results[g.key].map((hit): Row => ({ type: "hit", hit }))),
    ],
    [commands, results]
  );
  const hasResults = flat.length > 0;

  // ⌘/ (the hint on the box) and ⌘K both focus the search.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "/" || e.key === "k")) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const pickRow = (row: Row) => {
    if (row.type === "hit") return pick(row.hit);
    row.command.run();
    close();
  };

  const pick = (hit: SearchHit) => {
    if (hit.kind === "issue") openIssue(hit.key);
    else if (hit.kind === "session") selectSession(hit.id);
    else if (hit.kind === "pr") void openUrl(hit.url);
    else {
      // A chat hit opens whatever owns that workspace: a session by id, or
      // the issue (term:KEY shells belong to their issue's workspace too).
      const id = hit.workspaceId;
      const session = useSessionsStore.getState().sessions.find((s) => s.id === id);
      if (session) selectSession(session.id);
      else openIssue(id.startsWith("term:") ? id.slice(5) : id);
    }
    close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (!hasResults) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      const row = flat[Math.min(active, flat.length - 1)];
      if (row) pickRow(row);
    }
  };

  // Build rows with group headers; track each hit's flat index for highlight.
  let flatIndex = -1;

  return (
    <div className="search" ref={rootRef}>
      <I.Search size={13} />
      <input
        ref={inputRef}
        placeholder="Search, or > for actions…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd>⌘ /</kbd>
      {open && (
        <div className="search-pop">
          {!hasResults && <div className="sr-empty">No matches.</div>}
          {COMMAND_GROUPS.map((g) => {
            const rows = commands.filter((c) => c.group === g.key);
            if (rows.length === 0) return null;
            return (
              <div key={g.key}>
                <div className="sr-group">{g.label}</div>
                {rows.map((c) => {
                  flatIndex++;
                  const idx = flatIndex;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      className={`sr-row${idx === active ? " active" : ""}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => pickRow({ type: "command", command: c })}
                    >
                      {g.key === "needs" && <span className="light-dot attention" />}
                      <span className="sr-title">{c.label}</span>
                      {c.sub && <span className="sr-sub">{c.sub}</span>}
                      {c.kbd && <kbd className="sr-kbd">{c.kbd}</kbd>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {GROUPS.map((g) => {
            const hits = results[g.key];
            if (hits.length === 0) return null;
            return (
              <div key={g.key}>
                <div className="sr-group">{g.label}</div>
                {hits.map((hit) => {
                  flatIndex++;
                  const idx = flatIndex;
                  const key =
                    hit.kind === "issue"
                      ? hit.key
                      : hit.kind === "session"
                        ? hit.id
                        : hit.kind === "pr"
                          ? hit.url
                          : hit.workspaceId;
                  return (
                    <button
                      type="button"
                      key={`${hit.kind}:${key}`}
                      className={`sr-row${idx === active ? " active" : ""}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => pick(hit)}
                    >
                      {hit.kind === "issue" && <span className="sr-chip">{hit.key}</span>}
                      <span className="sr-title">{hit.title}</span>
                      {hit.sub && <span className="sr-sub">{hit.sub}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
