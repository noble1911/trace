# Agents, PTY, and lifecycle rules

## The PTY transport (reused from `../claude-orchestrator/src-tauri/src/claude/pty.rs`)

- An agent is the **interactive** `claude` TUI in a pseudo-terminal — no `--print`/`--output-format`/
  `--input-format`. Headless `-p` mode is being retired, so we only use PTY.
- `spawn_claude_pty(...)` opens the PTY rooted at the worktree `cwd`, pins a `--session-id` (or `--resume`s an
  existing one), pumps raw bytes to the frontend via the `pty-output` event (base64-encoded to preserve ANSI +
  multibyte splits), and emits `pty-exit` + tears down agent state on EOF.
- The frontend renders `pty-output` bytes in an **xterm.js** pane and forwards keystrokes/resize back through
  commands. Do not try to parse the byte stream for structured data — it's a screen, not JSON.

## Worktrees

- Each agent runs in an isolated worktree at `<repo>/.worktrees/<issue-key>` on branch `workspace/<issue-key>`
  (via the reused `git.rs`). One agent per worktree.
- Use `git_busy_check` before mutating a repo; respect the detected default branch.

## Lifecycle ⇄ actions (replaces the prototype's mock `onMove` side-effects)

- → **in progress** column: ensure a worktree exists for the issue, then `spawn_claude_pty`.
- → **review** column: `git push` + `gh pr create` (reused `commands/pr.rs`).
- → **done** column: merge the PR.
- Each transition ALSO fires the matching Jira transition (see `jira.md`). UI moves optimistically; reconcile on
  result.

## Security (carried over — these were learned the hard way)

- **Never** `eprintln!`/log/emit env vars or secrets (`ANTHROPIC_API_KEY`, AWS keys, Jira tokens).
- Constant-time compare for any token equality (`fixed_length_constant_time_eq`); never `==` on secrets.
- Keep `claude`/`git`/`gh` discovery platform-aware (reused `claude/discovery.rs`); don't assume mac paths.

## Cross-platform

- macOS is the primary test target; Windows must keep building. Avoid mac-only shell invocations
  (`open -b ...`) in new code paths, or gate them behind `#[cfg(target_os = "macos")]`.
</content>
