# CLAUDE.md

Guidance for working in **trace** — a Jira-driven Kanban desktop app for managing parallel Claude coding
sessions. Each card is a Jira issue from the user's current sprint; starting work on one spawns an interactive
Claude CLI session in an isolated git worktree.

## Stack

- **Shell:** Tauri 2 (Rust backend + React/TypeScript/Vite frontend). Targets macOS (primary) and Windows.
- **Frontend:** React 19, TypeScript (strict), Vite 7, vanilla CSS with design tokens (no Tailwind).
- **Backend:** Rust 2021. Interactive Claude via `portable-pty`; git worktrees + `gh` for PRs; SQLite (`rusqlite`).
- **Jira:** Cloud REST (Agile v1.0 + Platform v3), HTTP Basic (email + API token), credentials in the OS keychain.
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
primitives under `src/components/`; the app shell under `src/app/`.

```
src/
├── main.tsx                # entry
├── App.tsx                 # shell + nav routing ONLY (keep < ~150 lines)
├── app/                    # Rail, Topbar, nav state
├── styles/                 # tokens.css (design tokens), globals.css
├── ipc/                    # typed invoke<T> wrappers — the ONLY place that calls Tauri `invoke`
├── components/             # shared UI primitives (Icon, AgentAvatar, StatusPill, Modal)
└── domains/
    ├── jira/               # api.ts, types.ts, store.ts, components/  (auth, board/sprint mapping)
    ├── board/              # Board, Column, Card, FilterChip
    ├── agent/              # AgentDetail + tabs, PTY xterm pane
    └── orchestrator/       # Fab, Panel, SpawnModal
```

**Backend — one module per concern.** `commands/*.rs` files hold only thin `#[tauri::command]` wrappers; the
real work lives in domain modules (`claude/`, `jira/`, `git.rs`).

```
src-tauri/src/
├── lib.rs                  # AppState + run() + invoke_handler registration ONLY
├── types.rs helpers.rs database.rs git.rs
├── claude/                 # discovery, env, models, stream, runner, pty
├── jira/                   # auth, client, models, board  (Jira Cloud REST)
└── commands/               # thin wrappers: agent.rs, workspace.rs, pr.rs, jira.rs
```

Detailed rules live in `.claude/rules/` — read the one relevant to your change:

- `.claude/rules/architecture.md` — module boundaries, IPC, state, splitting heuristics
- `.claude/rules/code-style.md` — TS/React/Rust style, naming, imports
- `.claude/rules/jira.md` — auth, board→columns / sprint→cards mapping, transitions
- `.claude/rules/agents.md` — PTY runner, worktrees, lifecycle ↔ actions, security

## Core concepts

- **Issue ⇄ card:** every board card is a Jira issue in the user's active sprint. There is no local ticket store
  — Jira is the source of truth. Columns come from the user's *board configuration*, never hardcoded.
- **Agent:** an interactive `claude` TUI hosted in a PTY, rooted in a git worktree created for one issue.
  Output is raw ANSI bytes rendered in xterm.js (not structured JSON — `-p`/headless is being retired).
- **Lifecycle:** moving a card transitions the Jira issue AND triggers the matching action — start agent (→ in
  progress), raise PR (→ review), merge (→ done).

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
- **Never log, emit, or return secrets** (Jira tokens, env). Jira credentials stay in the keychain on the Rust
  side and never cross to the renderer.
- New code stays cross-platform: no mac-only shell assumptions; keep `git`/`gh`/`claude` discovery
  platform-aware.
</content>
