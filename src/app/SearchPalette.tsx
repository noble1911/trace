import { openUrl } from "@tauri-apps/plugin-opener";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import { useSessionsStore } from "@/domains/sessions/store";
import { runSearch, type SearchHit } from "./search";

const GROUPS: { key: "issues" | "sessions" | "prs" | "chats"; label: string }[] = [
  { key: "issues", label: "Tickets" },
  { key: "sessions", label: "Sessions" },
  { key: "prs", label: "Pull requests" },
  { key: "chats", label: "Chats" },
];

// The topbar search: a command-palette dropdown over issues, sessions, PRs,
// and live chat output. ⌘/ focuses it; arrows + Enter navigate; Esc closes.
export function SearchPalette() {
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

  const results = useMemo(() => runSearch(debounced), [debounced]);
  const flat = useMemo(() => GROUPS.flatMap((g) => results[g.key]), [results]);
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
      const hit = flat[Math.min(active, flat.length - 1)];
      if (hit) pick(hit);
    }
  };

  // Build rows with group headers; track each hit's flat index for highlight.
  let flatIndex = -1;

  return (
    <div className="search" ref={rootRef}>
      <I.Search size={13} />
      <input
        ref={inputRef}
        placeholder="Search tickets, sessions, chats…"
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
      {open && debounced.trim().length >= 2 && (
        <div className="search-pop">
          {!hasResults && <div className="sr-empty">No matches.</div>}
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
