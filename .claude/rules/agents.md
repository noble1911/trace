# Agents, PTY, and lifecycle rules

## The PTY transport (reused from `../claude-orchestrator/src-tauri/src/claude/pty.rs`)

- An agent is the **interactive** `claude` TUI in a pseudo-terminal — no `--print`/`--output-format`/
  `--input-format`. Headless `-p` mode is being retired, so we only use PTY.
- `spawn_agent_pty(...)` (in `claude/pty.rs`) opens the PTY rooted at the worktree `cwd`, pins a `--session-id`
  (or `--resume`s an existing one), pumps raw bytes to the frontend via the `pty-output` event (base64-encoded
  to preserve ANSI + multibyte splits), and emits `pty-exit` + tears down agent state on EOF. `spawn_shell_pty`
  does the same for the plain shell in the Terminal tab.
- The frontend renders `pty-output` bytes in an **xterm.js** pane and forwards keystrokes/resize back through
  commands. Do not try to parse the byte stream for structured data — it's a screen, not JSON.

## Worktrees

- Each agent runs in an isolated worktree at `<repo>/.worktrees/<slug>` on branch `workspace/<slug>`, where
  `<slug>` is the slugified issue key (`helpers::slugify`, e.g. `TRACE-12` → `trace-12`). One agent per worktree.
- Use `git_busy_check` before mutating a repo; respect the detected default branch.

## Lifecycle ⇄ actions (replaces the prototype's mock `onMove` side-effects)

- → **in progress** column: ensure a worktree exists for the issue, then `spawn_agent_pty`.
- → **review** column: `git push` + `gh pr create` (reused `commands/pr.rs`).
- → **done** column: merge the PR.
- Each transition ALSO fires the matching Jira transition (see `jira.md`). UI moves optimistically; reconcile on
  result.

## Security (carried over — these were learned the hard way)

- **Never** `eprintln!`/log/emit env vars or secrets (`ANTHROPIC_API_KEY`, AWS keys, Jira tokens).
- If code ever needs to compare tokens for equality, use a constant-time compare; never `==` on secrets.
  (Nothing in the codebase compares tokens today — keep it that way or add the helper when needed.)
- Everything persisted under the app config dir is written `0600` (`helpers::restrict_perms`) — new
  persistence goes through the same helper.
- `claude`/`git`/`gh` are resolved via `claude/discovery.rs` — never hardcode an absolute tool path.

## Platform

- macOS only. Windows support was dropped (2026-06); don't add `#[cfg(windows)]` paths or spend effort keeping
  Windows building.
