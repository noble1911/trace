import { useBoardStore } from "@/domains/board/store";
import { useSessionsStore } from "@/domains/sessions/store";

// Global search over everything the app already holds in memory: board
// issues, exploratory sessions, linked PRs, and live chat output (the PTY
// buffers, decoded and stripped of ANSI). Pure data out — the palette
// component decides how to act on a hit.

export type SearchHit =
  | { kind: "issue"; key: string; title: string; sub: string }
  | { kind: "session"; id: string; title: string; sub: string }
  | { kind: "pr"; url: string; title: string; sub: string }
  | { kind: "chat"; workspaceId: string; title: string; sub: string };

export interface SearchResults {
  issues: SearchHit[];
  sessions: SearchHit[];
  prs: SearchHit[];
  chats: SearchHit[];
}

const PER_GROUP = 5;
/** Searchable tail kept per workspace — old scrollback past this is dropped. */
const MAX_CHAT_TEXT = 200_000;

function decodeChunk(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// CSI sequences, OSC sequences (incl. hyperlinks), and stray control chars —
// the screen-painting noise between the words.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences is this regex's entire job
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x00-\x08\x0b-\x1f]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// Decoded chat text per workspace. Buffers are append-only while the app
// runs, so we only decode chunks added since the last search.
const chatCache = new Map<string, { count: number; text: string }>();

function chatText(workspaceId: string, chunks: string[]): string {
  const cached = chatCache.get(workspaceId);
  let from = 0;
  let text = "";
  if (cached && cached.count <= chunks.length) {
    from = cached.count;
    text = cached.text;
  }
  for (let i = from; i < chunks.length; i++) {
    try {
      text += stripAnsi(decodeChunk(chunks[i]));
    } catch {
      // Skip an undecodable chunk rather than losing the whole buffer.
    }
  }
  if (text.length > MAX_CHAT_TEXT) text = text.slice(-MAX_CHAT_TEXT);
  chatCache.set(workspaceId, { count: chunks.length, text });
  return text;
}

/** ~60 chars of context around the first match, on one line. */
function snippet(text: string, qLower: string): string {
  const at = text.toLowerCase().indexOf(qLower);
  if (at < 0) return "";
  const start = Math.max(0, at - 24);
  const slice = text
    .slice(start, at + qLower.length + 36)
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${slice}…`;
}

export function runSearch(query: string): SearchResults {
  const q = query.trim().toLowerCase();
  const out: SearchResults = { issues: [], sessions: [], prs: [], chats: [] };
  if (q.length < 2) return out;

  const board = useBoardStore.getState();
  const sessionsState = useSessionsStore.getState();

  for (const i of board.data?.issues ?? []) {
    if (out.issues.length >= PER_GROUP) break;
    const hay =
      `${i.key} ${i.summary} ${i.labels.join(" ")} ${i.assignee?.displayName ?? ""}`.toLowerCase();
    if (hay.includes(q)) {
      out.issues.push({ kind: "issue", key: i.key, title: i.summary, sub: i.statusName });
    }
  }

  for (const s of sessionsState.sessions) {
    if (out.sessions.length >= PER_GROUP) break;
    if (s.archivedAt) continue;
    if (`${s.title} ${s.cli}`.toLowerCase().includes(q)) {
      out.sessions.push({ kind: "session", id: s.id, title: s.title, sub: s.cli });
    }
  }

  const seenPr = new Set<string>();
  for (const [issueKey, prs] of Object.entries(board.pullRequests)) {
    for (const pr of prs) {
      if (out.prs.length >= PER_GROUP) break;
      if (!pr.url || seenPr.has(pr.url)) continue;
      seenPr.add(pr.url);
      if (`#${pr.number} ${pr.title} ${issueKey}`.toLowerCase().includes(q)) {
        out.prs.push({
          kind: "pr",
          url: pr.url,
          title: pr.title,
          sub: `#${pr.number} · ${pr.state}`,
        });
      }
    }
  }

  for (const [workspaceId, chunks] of Object.entries(board.outputBuffers)) {
    if (out.chats.length >= PER_GROUP) break;
    const text = chatText(workspaceId, chunks);
    const sub = snippet(text, q);
    if (!sub) continue;
    const issueKey = workspaceId.startsWith("term:") ? workspaceId.slice(5) : workspaceId;
    const session = sessionsState.sessions.find((s) => s.id === workspaceId);
    const title = session
      ? session.title
      : workspaceId.startsWith("term:")
        ? `${issueKey} · terminal`
        : workspaceId;
    out.chats.push({ kind: "chat", workspaceId, title, sub });
  }

  return out;
}
