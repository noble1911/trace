import type { RemoteRepo } from "../repos/types.ts";
import type { ScratchSession, SessionHost } from "./types.ts";

// What a session on another host (a Vercel Sandbox) can't do, and how to say
// where it runs and what state its sandbox is in. Pure (relative `.ts` imports)
// so `npm test` can run it.

/** Mirrors the backend's refusal in `commands/session_host.rs`. */
export const SANDBOX_NO_AGENTS = "A Vercel Sandbox session can't have extra agents yet";

/** The same, for a session on another computer running trace. */
export const PEER_NO_AGENTS = "A session on another computer can't have extra agents yet";

/**
 * Why "+ agent" is off for this session, or null when it can take another. A
 * sandbox session can't have any (the backend refuses); a local one stops at `max`.
 */
export function addAgentBlocker(session: ScratchSession, max: number): string | null {
  if (session.host) {
    return session.host.kind === "peer" ? PEER_NO_AGENTS : SANDBOX_NO_AGENTS;
  }
  if ((session.agents?.length ?? 0) >= max) {
    return "This session already has the maximum number of agents";
  }
  return null;
}

/** Where a sandbox session's agent works, for its start overlay. */
export function hostHint(host: SessionHost): string {
  if (host.kind === "peer") return "Runs on another computer running trace, not on this one.";
  return host.remote
    ? `Runs in a Vercel Sandbox cloned from ${host.remote}, not on this computer.`
    : "Runs in a Vercel Sandbox, not on this computer.";
}

/** Where a sandbox session lives, for a header or a list row: "Vercel Sandbox · owner/name". */
export function hostPlace(host: SessionHost): string {
  if (host.kind === "peer")
    return host.repo ? `Another computer · ${host.repo}` : "Another computer";
  return `Vercel Sandbox · ${host.remote ?? host.sandbox}`;
}

/** The tooltip on a remote session's id: its sandbox's name, or its id on the peer. */
export function hostId(host: SessionHost): string {
  return host.kind === "peer" ? host.remoteId : host.sandbox;
}

/** Vercel's lowercase word for a sandbox, said as the sandbox's: "Sandbox running". */
export function sandboxStatusLabel(status: string): string {
  const word = status.trim().toLowerCase();
  return word ? `Sandbox ${word}` : "Sandbox";
}

/** A configured repo as far as a sandbox cares: its path and GitHub remote. */
interface RepoOrigin {
  path: string;
  remote: RemoteRepo | null;
}

/**
 * The repos a sandbox can run (its GitHub origin is what it clones) and the
 * ones it can't, each in the given order.
 */
export function sandboxRepos(repos: RepoOrigin[]): { usable: string[]; skipped: string[] } {
  const onGitHub = (r: RepoOrigin) => r.remote?.host.toLowerCase() === "github.com";
  return {
    usable: repos.filter(onGitHub).map((r) => r.path),
    skipped: repos.filter((r) => !onGitHub(r)).map((r) => r.path),
  };
}

const HOBBY = "Runs in a Vercel Sandbox; on the Hobby plan a sandbox ends after 45 minutes.";

/**
 * New Session's note when it runs in a sandbox, given the repo names it can and
 * can't use (null while they're read): why some repos aren't in the list.
 */
export function sandboxRepoNote(repos: { usable: string[]; skipped: string[] } | null): string {
  if (!repos) return "Checking which of your repositories are on GitHub…";
  const { usable, skipped } = repos;
  if (usable.length === 0 && skipped.length === 0) {
    return "A Vercel Sandbox session needs a repository. Add one in Settings → Repositories.";
  }
  if (usable.length === 0) {
    return "A Vercel Sandbox clones its repository from GitHub, and none of yours has a GitHub origin. Clone one in Integrations → GitHub, or set a GitHub remote as origin.";
  }
  if (skipped.length === 0) return HOBBY;
  return `${HOBBY} Not listed, as a sandbox clones from GitHub and they have no GitHub origin: ${skipped.join(", ")}.`;
}

/** A session's sandbox as the backend reports it (`commands/sandbox_state.rs`). */
export interface SandboxStateLike {
  /** Vercel's word; empty when there's no sandbox. */
  status: string;
  saved: boolean;
  /** Epoch ms. */
  stopsAt: number | null;
  /** Epoch ms. */
  savedUntil: number | null;
}

/** What the session's Details say about its sandbox: a state, and what it means. */
export interface SandboxFacts {
  state: string;
  detail: string;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** "32 min", "1 h 5 min", "under a minute". */
export function timeLeft(ms: number): string {
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}

function stopsIn(stopsAt: number | null, now: number, otherwise: string): string {
  if (stopsAt === null) return otherwise;
  return stopsAt > now
    ? `Vercel stops it in ${timeLeft(stopsAt - now)}.`
    : "Vercel is stopping it.";
}

function keptFor(savedUntil: number, now: number): string {
  const days = Math.floor((savedUntil - now) / DAY);
  if (days < 1) return "Its snapshot is kept for less than a day more.";
  return `Its snapshot is kept for ${days} more ${days === 1 ? "day" : "days"}.`;
}

/**
 * The sandbox's state in words: running with trace attached or unattended, saved
 * as a snapshot, or expired (nothing to resume), and the time left on each when
 * Vercel says. `attached` = this trace has the agent open.
 */
export function sandboxFacts(s: SandboxStateLike, attached: boolean, now: number): SandboxFacts {
  const status = s.status.trim().toLowerCase();
  if (status === "running") {
    return attached
      ? { state: "Running", detail: stopsIn(s.stopsAt, now, "Keep-alive extends it while open.") }
      : {
          state: "Running unattended",
          detail: stopsIn(s.stopsAt, now, "Claude keeps working until the plan's time limit."),
        };
  }
  if (status === "pending" || status === "starting") {
    return { state: "Starting", detail: "Vercel is starting the sandbox." };
  }
  if (status === "stopping" || status === "snapshotting") {
    return { state: "Saving", detail: "Vercel is saving a snapshot of the sandbox." };
  }
  if (!status) {
    return { state: "No sandbox", detail: "Start makes one, cloned from GitHub." };
  }
  const expired = !s.saved || (s.savedUntil !== null && s.savedUntil <= now);
  if (status === "stopped" && expired) {
    return {
      state: "Expired",
      detail: "Nothing saved to resume. Start makes a new sandbox from the pushed branch.",
    };
  }
  if (status === "stopped") {
    const kept = s.savedUntil === null ? "" : ` ${keptFor(s.savedUntil, now)}`;
    return { state: "Saved", detail: `Start resumes it from its snapshot.${kept}` };
  }
  return { state: sandboxStatusLabel(status), detail: "As Vercel reports it." };
}

/** How long to wait before asking Vercel again about a sandbox that has settled. */
export const SANDBOX_POLL_MS = 60_000;
/** …and about one that's on its way somewhere (starting, saving, not there yet). */
export const SANDBOX_POLL_FAST_MS = 5_000;

/**
 * When to ask Vercel about the sandbox again. Soon while it's moving: starting,
 * saving, or not there yet although the agent is running (Start makes the
 * sandbox after the agent attaches, so the first answer is often "none").
 * Otherwise once a minute. `status` is null before the first answer.
 */
export function sandboxPollMs(status: string | null, attached: boolean): number {
  const s = status?.trim().toLowerCase() ?? null;
  if (s === null) return SANDBOX_POLL_FAST_MS;
  if (["pending", "starting", "stopping", "snapshotting"].includes(s)) return SANDBOX_POLL_FAST_MS;
  if (s === "" && attached) return SANDBOX_POLL_FAST_MS;
  return SANDBOX_POLL_MS;
}
