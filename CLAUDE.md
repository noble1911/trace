# CLAUDE.md

Guidance for working in **trace** — a desktop app for managing parallel Claude coding sessions. Its Kanban board
shows issues from a connected tracker (Jira or Pylon, optional); starting work on one spawns an interactive Claude
CLI session in an isolated git worktree. Sessions and scheduled prompts work with no tracker connected.

## Stack

- **Shell:** Tauri 2 (Rust backend + React/TypeScript/Vite frontend). Ships on macOS; Windows and Linux are in
  progress (`docs/WINDOWS_LINUX_PLAN.md`).
- **Frontend:** React 19, TypeScript (strict), Vite 7, vanilla CSS with design tokens (no Tailwind).
- **Backend:** Rust 2021. Interactive Claude via `portable-pty`; git worktrees + `gh` for PRs. Persistence is
  small JSON files in the app config dir (`~/Library/Application Support/trace/` on macOS, via `dirs`), all written `0600`
  through `helpers::persist` — there is no database.
- **Issue trackers:** pluggable providers behind `issues::IssueProvider` (see `.claude/rules/providers.md`).
  **Jira:** Cloud REST (Agile v1.0 + Platform v3), HTTP Basic (email + API token). **Pylon:** REST, Bearer
  token. Credentials live in user-only (`0600`) files in the app config dir — *not* the keychain; see
  `.claude/rules/jira.md` for why.
- **Tooling:** Biome (lint + format), `tsc --noEmit`, `cargo test`.

## The one rule that matters most: keep files small

The previous version of this app (`../claude-orchestrator`) collapsed into a 4,343-line `App.tsx` and a
3,800-line `lib.rs`, and its CLAUDE.md is now mostly a multi-phase plan to claw that back. **We do not repeat
that.**

- **Soft target: ≤ 250 lines per file. Hard cap: ~400 lines.** When a file reaches the cap, split it *before*
  adding more — extract a component, hook, or submodule. Splitting early is cheap; untangling a 1,000-line file
  is not.
- `App.tsx` and `src-tauri/src/lib.rs` are **thin shells only** (routing/state wiring for the former; `AppState`
  + `run()` + command registration for the latter). Business logic never lives there.
- One component / one concern per file. If you're scrolling to find things, it's too big.

This is the project's headline convention. Everything below supports it.

## Architecture

**Frontend — organize by domain, not by layer.** Feature code lives under `src/domains/<domain>/`; shared
primitives under `src/components/`; the app shell under `src/app/`. Typed backend calls live in `src/ipc/`
(one file per command area), **not** in the domains.

```
src/
├── main.tsx                # entry
├── App.tsx                 # shell + nav routing ONLY (keep < ~150 lines)
├── app/                    # Rail, Topbar, nav state, toasts
├── styles/                 # tokens.css (design tokens), globals.css
├── ipc/                    # typed invoke<T> wrappers — the ONLY place that calls Tauri `invoke`
├── components/             # shared UI primitives (Icon, AgentAvatar, StatusPill, Modal, Toaster)
└── domains/
    ├── issues/             # provider-agnostic tracker connection (store, types)
    ├── integrations/       # the Integrations page: a card per service, connect/disconnect dialog
    ├── github/             # GitHub sign-in (trace's own token), repo browser, clone, post-clone setup step
    ├── repos/              # the repo model (remote + checkouts) and its worktree setup editor
    ├── board/              # Board, Column, Card, filters; store also tracks agent run-state + PTY buffers
    ├── agent/              # AgentDetail + tabs (chat/ticket/files/terminal/tests/PR), xterm registry, defaults
    ├── plans/              # the Plan tab: plans and published documents, versions, task list, export
    ├── browser/            # the Browser tab: pages in an isolated native webview laid over the pane
    ├── gallery/            # the Gallery tab: sets of images, thumbnail grid, zoom/compare viewer
    ├── sessions/           # exploratory (non-Jira) Claude sessions
    ├── schedules/          # scheduled prompts: list, form, run history + run viewer
    ├── prs/                # pull-request list view
    ├── activity/           # activity feed — renders the backend activity log (types + store)
    ├── inbox/              # agents that need you, answered in place
    ├── fleet/              # every running agent
    ├── live/               # each agent's live state (the source for StatusLight) + answering its prompts
    ├── orchestrator/       # the assistant in the side panel
    ├── agentTools/         # the tools agents call on trace (board = the orchestrator's, + scheduled prompts)
    ├── sidebar/            # the rail's pages: order, show/hide, tracker-page rule (Settings → Sidebar)
    ├── appearance/         # themes (CSS in styles/themes.css), accent, density, fonts, xterm schemes
    ├── buddy/              # rail pixel buddy: mood from board/activity, Haiku speech; art is data (art/ART.md)
    └── settings/           # repos, agent defaults, integrations
```

**Backend — one module per concern.** `commands/*.rs` files hold only thin `#[tauri::command]` wrappers; the
real work lives in domain modules (`claude/`, `issues/`, `jira/`, `pylon/`, `git.rs`).

```
src-tauri/src/
├── lib.rs                  # run() + invoke_handler registration ONLY
├── state.rs helpers.rs git.rs
├── platform/               # OS ports + the macOS/Linux/Windows adapters; the only home for OS-specific code
├── claude/                 # discovery, env, pty, turn hooks, conversation ids  (the interactive TUI transport)
├── activity/               # persisted activity log (JSONL) + `activity-event`; every producer records here
├── issues/                 # IssueProvider trait, Provider enum, shared models, active-provider session
├── jira/                   # Jira provider: auth, client, parse, board, dev  (Jira Cloud REST)
├── pylon/                  # Pylon provider: auth, client, models, board  (Pylon REST)
├── schedule/               # scheduled prompts: cron/timing, runner loop, run lifecycle, hooks, transcripts
├── agent_tools/            # trace's own tools served to its agents over loopback MCP (renderer runs them)
├── plans/                  # the Plan tab's documents: capture (plan mode, transcripts), versions, store
├── browser/                # Browser tab: URL rules, pages store, child webviews, the IPC guard (`guard`)
├── gallery/                # Gallery tab: sets, scanning, path containment, the `trace-img` protocol
├── repo_catalog/           # per-repo remote, checkouts, default branch + worktree setup hooks
├── interrupted.rs          # ledger of live agents; ones cut off by quit/update/crash are offered back
├── execution/              # where agents run: AgentHost port; this machine, or a cloud sandbox
│                           #   (sandbox/ + vercel/: terminal in tmux, chat as a background command)
├── mcp_auth/               # trace's own OAuth logins to the team's MCP servers, for sandboxes
└── commands/               # thin wrappers: agent, session, schedules, issues, activity, pr, diff, tests, repos, editor
```

Detailed rules live in `.claude/rules/` — read the one relevant to your change:

- `.claude/rules/architecture.md` — module boundaries, IPC, state, splitting heuristics
- `.claude/rules/code-style.md` — TS/React/Rust style, naming, imports
- `.claude/rules/providers.md` — provider abstraction, Pylon specifics, adding providers
- `.claude/rules/jira.md` — Jira auth, board→columns / sprint→cards mapping, transitions
- `.claude/rules/agents.md` — PTY runner, worktrees, lifecycle ↔ actions, security
- `.claude/rules/tabs.md` — the one rule every workspace tab that comes and goes follows (`panes/coming.ts`)

UI changes of any kind: load the **`trace-ui` skill** (`.claude/skills/trace-ui/SKILL.md`) first — control
sizes, which control to use, where panels go, how agent state is drawn — and run its checklist.

## Core concepts

- **Issue ⇄ card:** every board card is an issue from a connected tracker. Several can be connected at once, and
  each has its own page in the rail, shown only while it's connected (`app/nav.ts`: Board and Pull requests for
  Jira, Pylon for Pylon) unless the user pins it in Settings → Sidebar, which also orders and hides
  the rail's pages (`domains/sidebar/`). A page's switcher lists that tracker's boards, keyed `provider:boardId`. Only one board is loaded at a
  time, and a ticket's detail needs its board, so open tickets through `board/openIssueAnywhere.ts` unless it's
  known to be on the loaded board. There is no local ticket
  store — the tracker is the source of truth. On Jira, a board shows exactly what its Jira board shows —
  saved filter + sub-filter, open sprints only while one runs, minus the Kanban backlog column and anything
  finished before the board's done cutoff (`jira/scope.rs`); columns come from the user's *board
  configuration*. On Pylon, from a rolling 30-day window with state-derived columns. Never hardcoded.
- **Agent:** an interactive `claude` (or `codex`) TUI hosted in a PTY, rooted in a git worktree created for one
  issue. Output is raw ANSI bytes rendered in xterm.js (not structured JSON — it's a screen, not data). A
  `provider` axis (`"anthropic"` | `"moonshot"` | `"wafer"` | `"wafer-fast"` | `"deepseek"` |
  `"deepseek-pro"`) points the same Claude Code harness at a third-party Anthropic-compatible
  endpoint (Moonshot's Kimi direct, Wafer Serverless `Kimi-K3` / `kimi-k3-fast`, or DeepSeek
  `deepseek-v4-flash` / `deepseek-v4-pro[1m]`) via `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` env
  injected at spawn, plus `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` and
  `CLAUDE_CODE_SUBAGENT_MODEL` pinned to the provider model (so Claude Code's opus/sonnet/haiku
  aliases and subagent launches don't send Anthropic ids the endpoint rejects). Wafer normal+fast
  share one API key and send `Wafer-ZDR: required` via `ANTHROPIC_CUSTOM_HEADERS`. DeepSeek
  flash+pro share one key and set `CLAUDE_CODE_EFFORT_LEVEL=max`; default is Flash (V4-Flash-0731
  beats Pro Preview on DeepSeek's agent/coding benches), Pro is the heavier reasoning option
  (haiku/subagent still pin to flash). `commands/providers.rs` is the registry — each provider's
  key lives Rust-side in a `0600` config file and never crosses to the renderer. A non-Anthropic
  provider also overrides a foreign `--model` default (e.g. a Settings default like "fable") with
  its own.
- **Exploratory session:** the same agent transport without a tracker issue (`domains/sessions/`,
  `commands/session.rs`). Git is optional: it runs in a worktree of a configured repo, or in a plain `folder`
  (one the user picked, or a scratch folder under the app config dir that's deleted with the session). A session
  records who started it (`createdBy`: the user, an agent over `start_session` — taken from the
  calling agent's own MCP header — or a scheduled prompt; `commands/session_origin.rs`), and each
  Sessions-page list keeps its sort and manual order in `session-order.json` (`commands/session_order.rs`).
- **Scheduled prompt:** a prompt that fires on a schedule (interval / daily / weekly / monthly / cron) from
  a Rust runner thread (`schedule/runner.rs`, only while trace is open; one process leads via a file lock).
  Each prompt owns a worktree; each run is a fresh conversation keyed `sched:<runId>`, in a PTY
  or as a chat agent (the prompt's `transport`; a chat run's journal is its record). A run
  finishes when a turn ends with no background tasks pending and no new turn follows
  (`schedule/completion.rs`). Finished runs' output is saved to disk and
  replayed through `pty_snapshot`; "Continue as session" adopts the prompt's worktree + conversation.
- **Agent tools:** every agent trace spawns gets `--mcp-config` for a loopback MCP endpoint
  (`agent_tools/`, per-app bearer token, Host/Origin checked) plus an `mcp__trace` allow rule in its
  `--settings`. The renderer registers the tools and runs each call (`domains/agentTools/`): the board ones
  are the orchestrator's own (`get_board`, `move_issue`, `start_agent`, …) with no confirm card; the
  scheduled-prompt ones read prompts and runs, update a prompt (keeping its on/off state), and create one
  only paused; the session ones (`sessionTools.ts`) start a standalone session in a chosen repo —
  optionally with Claude Code's Remote Control (`--remote-control`, persisted on the session so every
  start keeps it) — type into it, slash commands included, and read its screen; `update_user` (`updateTool.ts`) puts a one-line progress note beside the calling agent on
  the Fleet page until its next prompt. `moreTools.ts` adds `interrupt_session` / `stop_session`
  (only for sessions the caller started, or their descendants, by `createdBy`: `ownership.ts`),
  `get_session_changes` (the Files tab's diff, capped), `get_session_pr` (the PR watcher's cache),
  `read_activity`, and `add_repo` / `clone_repo`, which wait on a confirm card the user answers
  (`RepoConfirm`, `confirmQueue.ts`). `viewerTools.ts` has `open_browser` (a page in the
  workspace's Browser tab: http/https only, loopback quiet, other hosts with a notice) and
  `show_images` (a folder or files in its Gallery tab). A Browser page is a native child webview
  that gets nothing of trace's: the capability names the `main` *webview*, every command from
  another webview is refused (`browser::guard`), and it can't load trace's own origins. Gallery
  images load only through `trace-img`, which serves image files inside the set's roots
  (canonicalised) to the main webview only. Codex agents get the same endpoint as `-c` overrides
  (`agent_tools/codex.rs`). Agents are top-level
  Claude sessions: inherited Claude Code session markers (`claude::env::INHERITED_SESSION_ENV`) are
  stripped, or a trace started from a Claude session would hand its agents transcript saving off.
- **Interrupted agents:** `interrupted.rs` keeps `running-agents.json` (what each live agent was spawned
  with, and its pid). A natural exit removes the entry; quitting or an update restart (`shutting_down`)
  doesn't, so the next launch offers those agents back (`app/InterruptedAgents.tsx`). Resuming is
  `spawn_in` again, which `--resume`s the saved conversation; entries whose pid is alive belong to another
  running trace and are left alone.
- **Remote sessions:** a session can run in a Vercel sandbox (`ScratchSession.host`,
  `commands/session_host.rs`) behind the `execution::AgentHost` port, as a terminal (tmux over
  Vercel's PTY WebSocket) or a chat (`agent_session::process::ChatProcess` over a background
  command). Disconnect or quitting leaves it running and Start rejoins; Stop & save snapshots
  it. The host's `Capabilities` decide which tabs and views it gets. A *ticket* agent can run in a sandbox
  too (Start menu → Runs on, or Settings' default): `commands/issue_host.rs` keeps its host by issue key,
  `start_agent` skips the local worktree, and Terminal, Tests, Raise PR and Merge go (`agent/runsOn.ts`). Live tests:
  `cargo test vercel_live -- --ignored` with a token in `~/.config/trace-dev/vercel-token`.
  Design and findings: `docs/REMOTE_EXECUTION_PLAN.md`.
- **Lifecycle:** moving a card transitions the tracker's issue. With Settings' auto-start on, landing in the first
  in-progress column also starts its agent. That's the only automation: agents raise their own PRs, and the
  detail view's PR actions are explicit clicks.
- **Repositories:** `repos.json` lists the local folders agents run in; `repo_catalog/` adds what's known
  about each — its remote, its checkouts (local today; a tagged `Checkout` so remote execution can add a
  kind), default branch, and worktree setup (commands + files copied from the main checkout), run on its
  own thread after `git::create_worktree` makes a worktree. The GitHub integration signs trace in with
  its own token (`github/token.rs`: pasted PAT, a one-off copy of `gh auth token`, or OAuth device flow;
  a user-only file like Jira's) and lists (`repo_list.rs`) and clones (`clone.rs`) over the REST API, no
  `gh`. Cloning goes through `github/checkout.rs`, the portable clone-and-setup step (token only in the
  clone's env, never in args, URL or `.git/config`). PR watching, checks and threads still use `gh`.
- **Agent workspace tabs:** beyond the chat PTY, each agent has a ticket view, a diff/file viewer
  (`commands/diff.rs`), a plain shell terminal, a test runner (`commands/tests.rs`, auto-detects the toolchain),
  an open-in-editor action (`commands/editor.rs`), and a PR pane.

## Commands

```bash
npm install                                  # frontend deps
npm run tauri dev                            # run app (hot reload)
npm run tauri build                          # package
npx tsc --noEmit                             # typecheck frontend
cargo fmt --manifest-path src-tauri/Cargo.toml  # format Rust
npx @biomejs/biome check src                 # lint + format check
cargo test --manifest-path src-tauri/Cargo.toml
```

## Releases & updates

- Publishing a GitHub release (tag `vX.Y.Z`) triggers `.github/workflows/release.yml`. It builds macOS, Linux and
  Windows at the tag's version and uploads each one's installers plus updater bundle + minisign signature. Once
  all three succeed, its last job merges their parts into `latest.json`: if any fails, nobody is offered the release.
- `.github/workflows/cross-platform.yml` is the only other CI: it builds and tests all three OSes, by hand and on
  pushes to `port/**` or to `main` when platform code changes, and keeps Linux and Windows installers as artifacts.
- In-app updates (`tauri-plugin-updater`) poll `releases/latest/download/latest.json`; users install from
  Settings → Updates. Signing needs the `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` repo secrets (same key pair as
  claude-orchestrator; the pubkey is in `tauri.conf.json`).
- Don't bump `version` in `Cargo.toml`/`tauri.conf.json` by hand for releases — the workflow syncs it from the
  release tag.

## Roadmap

`docs/ROADMAP.md` lists planned features. When a change ships or starts a listed item, update it in the same PR.

## Non-negotiables (full list in .claude/rules/)

- Keep files small (above). Split at the cap.
- TypeScript strict; **no `any`** (use `unknown`); **named exports only**; no `React.FC`.
- Components never call `invoke` directly — go through `src/ipc/`.
- **Never log, emit, or return secrets** (Jira tokens, env). Jira credentials stay on the Rust side in a `0600`
  config file and never cross to the renderer.
- OS-specific code lives only in `src-tauri/src/platform/` and `src/platform/` (see `.claude/rules/agents.md`).
  Never hardcode tool paths — `git`/`gh`/`claude` discovery goes through `claude/discovery.rs`.
