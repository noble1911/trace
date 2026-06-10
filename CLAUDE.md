# CLAUDE.md

Guidance for working in **trace** — a Jira-driven Kanban desktop app for managing parallel Claude coding
sessions. Each card is a Jira issue from the user's current sprint; starting work on one spawns an interactive
Claude CLI session in an isolated git worktree.

## Stack

- **Shell:** Tauri 2 (Rust backend + React/TypeScript/Vite frontend). macOS only.
- **Frontend:** React 19, TypeScript (strict), Vite 7, vanilla CSS with design tokens (no Tailwind).
- **Backend:** Rust 2021. Interactive Claude via `portable-pty`; git worktrees + `gh` for PRs. Persistence is
  small JSON files in the app config dir (`~/Library/Application Support/trace/` via `dirs`), all written `0600`
  — there is no database.
- **Jira:** Cloud REST (Agile v1.0 + Platform v3), HTTP Basic (email + API token), credentials in a user-only
  (`0600`) file in the app config dir — *not* the keychain; see `.claude/rules/jira.md` for why.
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
    ├── jira/               # connection store, types, login UI
    ├── board/              # Board, Column, Card, filters; store also tracks agent run-state + PTY buffers
    ├── agent/              # AgentDetail + tabs (chat/ticket/files/terminal/tests/PR), xterm registry, defaults
    ├── sessions/           # exploratory (non-Jira) Claude sessions
    ├── prs/                # pull-request list view
    ├── activity/           # activity feed
    └── settings/           # repos, agent defaults, integrations
```

**Backend — one module per concern.** `commands/*.rs` files hold only thin `#[tauri::command]` wrappers; the
real work lives in domain modules (`claude/`, `jira/`, `git.rs`).

```
src-tauri/src/
├── lib.rs                  # run() + invoke_handler registration ONLY
├── state.rs helpers.rs git.rs
├── claude/                 # discovery, env, pty  (the interactive TUI transport)
├── jira/                   # auth, client, models, board, dev  (Jira Cloud REST)
└── commands/               # thin wrappers: agent, session, jira, pr, diff, tests, repos, editor
```

Detailed rules live in `.claude/rules/` — read the one relevant to your change:

- `.claude/rules/architecture.md` — module boundaries, IPC, state, splitting heuristics
- `.claude/rules/code-style.md` — TS/React/Rust style, naming, imports
- `.claude/rules/jira.md` — auth, board→columns / sprint→cards mapping, transitions
- `.claude/rules/agents.md` — PTY runner, worktrees, lifecycle ↔ actions, security

## Core concepts

- **Issue ⇄ card:** every board card is a Jira issue in the user's active sprint. There is no local ticket store
  — Jira is the source of truth. Columns come from the user's *board configuration*, never hardcoded.
- **Agent:** an interactive `claude` (or `codex`) TUI hosted in a PTY, rooted in a git worktree created for one
  issue. Output is raw ANSI bytes rendered in xterm.js (not structured JSON — it's a screen, not data).
- **Exploratory session:** the same agent transport without a Jira issue — a named scratch session in its own
  worktree (`domains/sessions/`, `commands/session.rs`).
- **Lifecycle:** moving a card transitions the Jira issue AND triggers the matching action — start agent (→ in
  progress), raise PR (→ review), merge (→ done).
- **Agent workspace tabs:** beyond the chat PTY, each agent has a ticket view, a diff/file viewer
  (`commands/diff.rs`), a plain shell terminal, a test runner (`commands/tests.rs`, auto-detects the toolchain),
  an open-in-editor action (`commands/editor.rs`), and a PR pane.

## Commands

```bash
npm install                                  # frontend deps
npm run tauri dev                            # run app (hot reload)
npm run tauri build                          # package
npx tsc --noEmit                             # typecheck frontend
npx @biomejs/biome check src                 # lint + format check
cargo test --manifest-path src-tauri/Cargo.toml
```

## Non-negotiables (full list in .claude/rules/)

- Keep files small (above). Split at the cap.
- TypeScript strict; **no `any`** (use `unknown`); **named exports only**; no `React.FC`.
- Components never call `invoke` directly — go through `src/ipc/`.
- **Never log, emit, or return secrets** (Jira tokens, env). Jira credentials stay on the Rust side in a `0600`
  config file and never cross to the renderer.
- macOS is the only supported platform, but never hardcode tool paths — `git`/`gh`/`claude` discovery goes
  through `claude/discovery.rs`.
