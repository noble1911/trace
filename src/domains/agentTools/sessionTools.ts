import type Anthropic from "@anthropic-ai/sdk";
import { activity } from "@/domains/activity/store";
import { agentArgs, agentCli, agentProvider } from "@/domains/agent/defaults";
import { decodePtyChunk, transcriptText } from "@/domains/agent/transcript";
import { useBoardStore } from "@/domains/board/store";
import { useLiveStore } from "@/domains/live/store";
import { useSessionsStore } from "@/domains/sessions/store";
import type { ScratchSession } from "@/domains/sessions/types";
import { type AgentCli, sendAgentInput } from "@/ipc/agent";
import { listRepos } from "@/ipc/repos";
import { createSession, startSession } from "@/ipc/session";

// Standalone-session tools for trace's agents: open a session in one of trace's
// repos (optionally with Remote Control, so it can be driven from claude.ai/code),
// type into it — slash commands included — and read its screen. The session is
// an ordinary one: it shows on the Sessions page, and opening it attaches to the
// same PTY.

/** A session's terminal size until its pane mounts and resizes it. */
const COLS = 120;
const ROWS = 40;
/** How long start_session watches for the Remote Control link before answering. */
const LINK_WAIT_MS = 15_000;

const SESSION_ID = {
  type: "string",
  description: "The session's id (from start_session or list_sessions), or its exact title.",
};

export const SESSION_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_repos",
    description:
      "List the repositories configured in trace — the ones a new session can run in. Takes no arguments.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_sessions",
    description:
      "List trace's standalone sessions (not ticket agents): id, title, repo, agent state (working / needs you / ready / stopped) and whether Remote Control is on.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "start_session",
    description:
      "Start a new standalone Claude session in its own worktree of one of trace's repos — for work that isn't a ticket. It shows on trace's Sessions page. With remote_control it's started with Claude Code's Remote Control, so it can also be driven from claude.ai/code and the Claude app; the link is returned when it appears. Give a prompt to set it working straight away; otherwise it waits at its prompt for send_to_session.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short name shown in trace (and in claude.ai/code).",
        },
        repo: {
          type: "string",
          description:
            "The repo to run in: its path or folder name from list_repos. May be omitted when only one is configured.",
        },
        prompt: {
          type: "string",
          description: "The first message to submit, e.g. the task. Omit to leave it idle.",
        },
        remote_control: {
          type: "boolean",
          description:
            "Enable Remote Control (claude.ai/code and the Claude app). Claude on Anthropic only.",
        },
        cli: {
          type: "string",
          enum: ["claude", "codex"],
          description:
            "The agent CLI; defaults to the user's setting. Remote Control needs claude.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "send_to_session",
    description:
      "Type a line into a standalone session's terminal and press Enter — a message, an answer, or a slash command like /compact. A stopped session is started (resuming its conversation) with the message as its first prompt.",
    input_schema: {
      type: "object",
      properties: {
        session_id: SESSION_ID,
        message: { type: "string", description: "The text to send." },
      },
      required: ["session_id", "message"],
    },
  },
  {
    name: "read_session",
    description:
      "Read a standalone session's state and the tail of its terminal — what it's doing, what it's asking, or its Remote Control link.",
    input_schema: {
      type: "object",
      properties: { session_id: SESSION_ID },
      required: ["session_id"],
    },
  },
];

const SESSION_TOOL_NAMES = new Set(SESSION_TOOLS.map((t) => t.name));

/** Whether `name` is one of these tools. */
export function isSessionTool(name: string): boolean {
  return SESSION_TOOL_NAMES.has(name);
}

function str(input: unknown, key: string): string {
  if (input && typeof input === "object" && key in input) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "string") return v.trim();
  }
  return "";
}

function bool(input: unknown, key: string): boolean {
  return !!input && typeof input === "object" && (input as Record<string, unknown>)[key] === true;
}

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

/** Match a repo by path or folder name; an unknown or ambiguous one names the choices. */
async function resolveRepo(wanted: string): Promise<string> {
  const repos = await listRepos();
  if (repos.length === 0)
    throw new Error("No repositories are configured in trace (Settings → Repos).");
  if (!wanted) {
    if (repos.length === 1) return repos[0];
    throw new Error(`Say which repo: ${repos.map(basename).join(", ")}.`);
  }
  const w = wanted.toLowerCase();
  const hits = repos.filter((r) => r.toLowerCase() === w || basename(r).toLowerCase() === w);
  if (hits.length === 1) return hits[0];
  throw new Error(
    `${hits.length ? "More than one" : "No"} repo matches "${wanted}". Choose from: ${repos.join(", ")}.`
  );
}

function findSession(ref: string): ScratchSession {
  const active = useSessionsStore.getState().sessions.filter((s) => !s.archivedAt);
  const byId = active.find((s) => s.id === ref);
  if (byId) return byId;
  const byTitle = active.filter((s) => s.title.toLowerCase() === ref.toLowerCase());
  if (byTitle.length === 1) return byTitle[0];
  throw new Error(
    byTitle.length
      ? `Several sessions are titled "${ref}" — use its id (list_sessions).`
      : `No session "${ref}". list_sessions shows them.`
  );
}

function stateOf(id: string): string {
  const info = useLiveStore.getState().info[id];
  const running = useBoardStore.getState().runningAgents.has(id);
  const light = info?.light ?? (running ? "working" : "stopped");
  const words = { attention: "needs you", working: "working", ready: "ready", stopped: "stopped" };
  const ask = info?.ask
    ? ` (${info.ask.label}${info.ask.detail ? `: ${info.ask.detail}` : ""})`
    : "";
  return `${words[light]}${ask}`;
}

/** The Remote Control link on a session's screen, if it's shown one yet. */
function remoteLink(id: string): string | null {
  const chunks = useBoardStore.getState().outputBuffers[id] ?? [];
  // A hyperlink's target (OSC 8) is intact even when the visible text wraps.
  const raw = chunks.map((c) => decodePtyChunk(c.data)).join("");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a link ends at the escape that closes it
  const re = /https:\/\/claude\.ai\/code[^\s\x07\x1b"'<>)\]]*/g;
  const found = raw.match(re) ?? transcriptText(chunks).match(re);
  return found ? found[found.length - 1] : null;
}

async function waitForLink(id: string): Promise<string | null> {
  const deadline = Date.now() + LINK_WAIT_MS;
  while (Date.now() < deadline) {
    const link = remoteLink(id);
    if (link) return link;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** Start (or resume) a session's agent and mark it running. */
async function launch(session: ScratchSession, prompt: string) {
  await startSession(session.id, COLS, ROWS, agentArgs(), prompt || undefined);
  const board = useBoardStore.getState();
  board.setAgentRunning(session.id, true);
  if (prompt) board.noteUserTurn(session.id);
}

async function start(input: unknown): Promise<string> {
  const title = str(input, "title") || "Exploration";
  const remote = bool(input, "remote_control");
  const cli: AgentCli = remote ? "claude" : str(input, "cli") === "codex" ? "codex" : agentCli();
  const repo = await resolveRepo(str(input, "repo"));
  const session = await createSession(title, cli, repo, agentProvider(), remote);
  useSessionsStore.getState().adopt(session);
  activity.log({
    kind: "session-created",
    actor: "agent",
    workspaceId: session.id,
    subject: session.title,
    title: `created session “${session.title}”`,
  });
  await launch(session, str(input, "prompt"));
  const head = `Started session "${session.title}" (id ${session.id}) in ${basename(repo)}.`;
  if (!remote) return head;
  const link = await waitForLink(session.id);
  return link
    ? `${head}\nRemote Control: ${link}`
    : `${head}\nRemote Control is on, but no link has shown yet — read_session will show it (or why it failed).`;
}

async function send(input: unknown): Promise<string> {
  const session = findSession(str(input, "session_id"));
  const message = str(input, "message");
  if (!message) return "Error: empty message.";
  const board = useBoardStore.getState();
  if (!board.runningAgents.has(session.id)) {
    await launch(session, message);
    return `"${session.title}" wasn't running — started it with that as its first message.`;
  }
  board.noteUserTurn(session.id);
  await sendAgentInput(session.id, `${message}\r`);
  return `Sent to "${session.title}".`;
}

function read(input: unknown): string {
  const session = findSession(str(input, "session_id"));
  const chunks = useBoardStore.getState().outputBuffers[session.id] ?? [];
  const tail = transcriptText(chunks, 6_000).trim();
  const link = session.remoteControl ? remoteLink(session.id) : null;
  const head = `"${session.title}" (id ${session.id}) — ${stateOf(session.id)}`;
  const lines = link ? [head, `Remote Control: ${link}`] : [head];
  return `${lines.join("\n")}\n\n${tail || "(no output yet)"}`;
}

async function list(): Promise<string> {
  const sessions = useSessionsStore.getState().sessions.filter((s) => !s.archivedAt);
  if (sessions.length === 0) return "No sessions.";
  return sessions
    .map((s) => {
      const repo = s.repo ? basename(s.repo) : "default repo";
      const rc = s.remoteControl ? " · Remote Control" : "";
      return `- ${s.id} "${s.title}" · ${repo} · ${s.cli} · ${stateOf(s.id)}${rc}`;
    })
    .join("\n");
}

/** Run one session tool. Returns the text for the model; throws on failure. */
export async function runSessionTool(name: string, input: unknown): Promise<string> {
  switch (name) {
    case "list_repos": {
      const repos = await listRepos();
      return repos.length
        ? repos.map((r) => `- ${basename(r)}: ${r}`).join("\n")
        : "No repos configured.";
    }
    case "list_sessions":
      return list();
    case "start_session":
      return start(input);
    case "send_to_session":
      return send(input);
    case "read_session":
      return read(input);
    default:
      return `Unknown tool: ${name}`;
  }
}
