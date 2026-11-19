# Agent chat: a structured view for every agent

Design for showing an agent as a formatted conversation (messages, tool runs, diffs, plans,
approval and question cards, a composer) rather than a terminal, the same way for every agent
brand. Modelled on Orca's structured mode (see "Prior art" below).

## Two transports, chosen per agent

| Transport | How the agent runs | What the user sees |
| --- | --- | --- |
| **Chat** (new) | Headless, speaking a structured protocol on stdin/stdout | The chat view, built from structured events |
| **Terminal** (today) | The interactive TUI in a PTY | xterm, plus the read-only transcript view from the CLI's files |

A session or ticket agent is started as one or the other: Settings → Agents has the default and
the New session dialog can override it. They can't share one process. "Open in terminal" forks a
chat agent's conversation into a terminal agent (`--resume`), and the reverse works the same way.
How that's wired is under "Choosing and switching the transport" below.

**Billing:** a probe on 2026-11-07 (Claude Code 2.1.319) showed headless Claude on a claude.ai
login reports `apiKeySource: "none"` and the subscription's `rate_limit_event` windows, so it
draws on the subscription. This is why the transport is a per-agent choice rather than a switch.

## One journal for every brand

Every adapter turns its protocol into the same rows: `agent_session::journal` (Rust) mirrored by
`src/domains/agentChat/types.ts`. A row has a stable `id`, a `revision` that grows as it changes
(streaming text, a tool finishing, a prompt being answered), and a `body`:

| Body | Carries |
| --- | --- |
| `message` | `role` (user, assistant, reasoning, system), Markdown `text`, `streaming`, `parentCallId` when a subagent said it |
| `tool` | `callId`, `name`, `input`, `state` (running, completed, failed), bounded `output`, `parentCallId` when a subagent made it, `subagent` when it started one |
| `diff` | a file change: `path`, `change` (add, edit, delete; not `kind`, which is the body's tag), `before`/`after` or a unified `patch` |
| `plan` | a task list: items with `text` and `status` (pending, in progress, done) |
| `approval` | a permission request: tool, title, detail, options (allow once, allow always, deny), `resolution`. Answered with `{kind: "approval", optionId, note?}` |
| `question` | one or more questions with options, multi-select, free text, `resolution`. Answered with `{kind: "questions", answers: {<question id>: [labels or text]}}` |
| `status` | a notice with a tone (info, warning, error) |
| `turn` | a turn's `state` (running, completed, interrupted, failed), duration, token usage and cost |

**Subagents.** The call that starts one (Claude's Task/Agent, Codex's `spawnAgent`) carries a
`subagent` (`agent_session::subagent`): `agentType`, `description`, `background`, `state`
(running, completed, failed, stopped), `activity`, `toolUses`, `durationMs` and its `result`. Its
`state` is separate from the call's: a background subagent's call returns at once while it works
on. Everything the subagent does is a row of its own (its messages and thinking, its calls, their
diffs and approvals) whose `parentCallId` names that call; its brief is the call's `input.prompt`.
A background subagent's rows can land after its turn ended: they keep the `turnId` of the turn
that started it, and never open a turn.

Plans and diffs are adapter output, not UI guesses: Claude's `TodoWrite` and Codex's plan updates
both become `plan`; Claude's `Edit`/`Write` and Codex's file changes both become `diff`.

**Plans.** The journal has no plan-document row: the Plan tab (`plans`, `src/domains/plans/`)
reads plans out of the rows as they're written (`plans::on_row`, from the runtime's sink), so
the contract is unchanged. A `tool` row named `ExitPlanMode` is a plan-mode document (its
`input.plan`, Markdown; the row's input is capped like any other, at `CAP_CHARS`); a completed
`Write`/`Edit`/`MultiEdit` row on a file in `~/.claude/plans/` is the plan file, read (from that
folder only) if ExitPlanMode's input had no plan, or at the turn's end if the turn wrote it but
never called ExitPlanMode. `plan` rows (TodoWrite, Codex's plan updates) are the tab's live task
list. A terminal agent's plans come from its Claude transcript instead, read as its hooks fire
(`plans::transcript`), through the same `plans::capture`.

Session-wide facts (model, session id, slash commands, rate-limit windows, `busy` while a turn
runs, `runningSubagents`) travel separately as `SessionInfo`, not as rows. An agent is working
while `busy` or `runningSubagents > 0` (`agentChat/working.ts`): background subagents keep it
working, and stoppable, after their turn ends.

`background` lists running tasks that aren't subagents: a shell left running, a monitor, a
workflow, a remote agent or teammate. Once its call returns such a task has no row that changes,
so this is where it shows: the chat's fact strip has a "Background N" control (`BackgroundWork`)
listing these with the running subagents, each stoppable by the call that started it. Workflows
and agents count in `runningSubagents` (they report back); shells and monitors don't (a dev
server can run all day while the agent is ready).

## Adapters

`agent_session::AgentAdapter` is the only thing a brand implements:

- `launch(spec, sink)`: start the agent (fresh, or resuming its saved conversation) and stream
  rows into the `JournalSink`.
- `send(message)`: a user turn. Sent while a turn runs, it steers that turn: Claude reads it after
  its current tool call (one `result` for both), Codex gets `turn/steer`.
- `answer(request_id, answer)`: resolve an approval or question.
- `interrupt()`: stop the current turn and every running subagent, background ones included; keep
  the agent. `stop_subagent(callId)`: stop one subagent. `stop()`: end the agent.

| Brand | Protocol | Notes |
| --- | --- | --- |
| Claude | `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio` | One long-lived process. Permissions and `AskUserQuestion` arrive as `control_request` (`can_use_tool`) and are answered with `control_response` on stdin. `--session-id` / `--resume` as today. trace's MCP tools and hooks are passed as for the terminal. |
| Codex | `codex app-server` (JSON-RPC over stdio) | `thread/start`/`resume`, `turn/start`/`interrupt`; approvals arrive as server requests. |
| Others | ACP (Agent Client Protocol) | Later: one generic adapter covers every ACP agent. |

Every process is spawned through `platform::process`; no OS checks outside `platform/`.

## Persistence

Rows are appended to `<config>/journals/<workspace id>.jsonl` (user-only, like all trace state;
there is no database). Loading keeps each id's highest revision. Reopening an agent replays its
journal; resuming it restarts the adapter against the saved conversation. Bounded payloads keep
the file small: tool output and file contents are capped, with a marker when cut.

As built (`agent_session::store`, `runtime`, `settle`):

- Streaming text isn't written until its final revision, or a long answer would be written once
  per token. It still reaches the renderer as every revision (`agent-journal`).
- A start rewrites the journal without superseded revisions once they outnumber its rows.
- Rows a vanished process left open (trace quit mid-turn) are settled: a start appends their
  ended revisions, and `load_journal` shows them ended while no agent runs. Prompts become
  cancelled, running tools failed, running turns interrupted.

## The Claude adapter, as built

`agent_session::claude`. One `claude -p … --permission-prompt-tool stdio` per agent, with the
conversation (`claude::conversations`), `--mcp-config`, `--settings` hooks, provider env and model
from `claude::launch`, the code the terminal transport uses too. Three threads: stdout and stderr
readers, and one that owns the child, its stdin and the translator, so nothing is shared or
locked. A terminal and a chat agent can't run on one workspace at once (one conversation).

The translator (`translate`) is pure and replayed in tests against recorded stream-json
(`claude/fixtures/`):

| Claude sends | Row |
| --- | --- |
| `stream_event` text / thinking deltas | `message` (assistant / reasoning), `streaming` until its block stops; the final `assistant` copy is skipped |
| `assistant` `tool_use` | `tool`, running; `parentCallId` from `parent_tool_use_id` |
| … Task / Agent | plus `subagent` (kind, description, background from the input); its row stays open until the subagent ends |
| `assistant` text / thinking with `parent_tool_use_id` | `message` with `parentCallId` (a subagent's words never stream: these lines are the only copy) |
| `system` `task_started` / `task_progress` / `task_notification` | that call's `subagent`: Claude's task id (for `stop_task`) and `is_backgrounded`; `activity`, tool count, time; the end (completed with `summary` as `result`, failed, stopped) |
| … `task_*` / `task_updated` for any other task (`task_type` `local_bash`, `monitor_*`, `local_workflow`, …) | `SessionInfo.background` (`claude/translate/tasks.rs`); a foreground shell only once backgrounded or its turn ends; one with a `parent_task_id` belongs to that task |
| `user` `tool_result` | that `tool` completed or failed, output capped |
| … for Edit, MultiEdit, Write | plus `diff`: `before`/`after` from the input, `patch` from `structuredPatch`, Write's add vs edit from `tool_use_result.type` |
| `tool_use` TodoWrite | `plan`, one per turn (no tool row) |
| `control_request` `can_use_tool` | `approval`: allow once, one "always" option per `permission_suggestions` entry (sent back as `updatedPermissions`), deny (with the note as its message) |
| … for AskUserQuestion | `question`; the answer goes back as `updatedInput.answers`, keyed by question text, several labels joined with ", " |
| `control_cancel_request` | that prompt cancelled |
| `result` | `turn` with `usage`; `costUsd` is the turn's share of the cumulative `total_cost_usd`; interrupted if trace asked or `terminal_reason` is `aborted_*`; an error result adds a `status` |
| `system` `init`, `rate_limit_event` | `SessionInfo`: model, session id, slash commands, `unifiedWindows` limits |

Interrupt is the stream-json `control_request` `interrupt`; the process stays up. It also stops
every subagent, background ones too (recorded in `subagent_interrupt.jsonl`), so trace sends it
with no turn running while a subagent works. One subagent stops with `control_request`
`stop_task` (`task_id` from `task_started`). Claude 2.1.319 with `--verbose`: a subagent's brief
comes as a `user` text message with `parent_tool_use_id` (trace takes it from the call's input
instead), its calls and text as `assistant` lines with it (no `stream_event`s), its report in the
call's `tool_result` (`tool_use_result.content`, after Claude's hand-back frame) and in
`task_notification.summary`. A background subagent's call returns "Async agent launched" at once
(`tool_use_result.status` `async_launched`), its rows come after the turn's `result`, and when it
ends Claude takes a turn of its own (`background_subagent.jsonl`). Other control
requests (hook callbacks, SDK MCP) are refused with an error response so Claude never waits on
one. Claude Code 2.1.319 has no TodoWrite tool, so its fixture is hand-made from a real turn.

## Choosing and switching the transport

**The choice.** Settings → Agents → *Shows as* is the default (Chat; stored in the renderer like
the other agent defaults). The New session dialog and the ticket's Start ▾ menu can pick the
other for one agent. Brands without a chat adapter (`agent_session::brands::CHAT_BRANDS`, which
`chat_agent_brands` returns) always get the terminal, and those controls say so. Sessions with
Remote Control are terminals (it's a TUI feature).

**Kept with the workspace.** `agent_session::transport` stores each workspace's transport in
`transports.json` (config dir) when its agent starts, or when the New session dialog picks one
(`set_agent_transport`). A start's transport is: what the caller asked for, else the stored one,
else the terminal (the renderer passes Settings' default for a workspace that never ran). It moves
with a session linked to a ticket, and goes with a deleted session or companion (its journal too).

There is no separate chat start command (the `start_chat_agent` of the first cut is gone):
**every start goes through `commands::agent::spawn_in`**, which routes by transport: a chat
agent to `agent_session::runtime::start`, a terminal one to the PTY. So the ticket start and
board kickoff (`start_agent`, which the orchestrator's `start_agent` tool reaches through the
board's kickoff), `start_session` (the session view and the MCP `start_session` tool),
`start_session_agent` (companions), the scheduled runs (always terminal) and resume-after-quit
(`resume_interrupted_agents`, the ledger records the transport) all honour it. A chat agent gets
the same model, provider and extra args as a terminal agent would, plus trace's MCP tools and
hooks (`brands::wiring` → `claude::launch` for Claude). The kickoff brief (or, resuming a conversation
cut off by a quit, the "carry on" nudge) is sent as the first chat message once the agent is up.

**History from outside a chat run.** Headless Claude resumes a conversation without replaying it,
so the journal only holds what chat runs saw. Turns taken in the terminal (before a switch to chat,
or between two chat runs) are read from Claude Code's conversation file instead: every entry whose
`entrypoint` isn't `sdk-cli` (a chat run's) becomes rows, ids prefixed `hist:`, through the
formatted transcript's parser (`agent_session::claude::history`). `agent_session::backfill` merges
them among the journal's rows by time and renumbers them in one locked rewrite, when a view reads the
journal with no agent running and when a chat agent starts (which then emits `agent-journal` with
`reset`, replacing the view's copy). Rows already there are skipped by id, a conversation no longer
than at its last sync isn't read again, and only the newest 4000 rows of history are kept, whole turns.
Codex isn't covered yet.

**Stop, restart, state.** `stop_agent` stops either kind; `agent_running` and `live_workspaces`
include chat agents, so every Stop button, the command palette and reload adoption work
unchanged. A chat agent's exit emits `agent-run-state` and updates the interrupted ledger like a
PTY's. `chat_agent_state` returns a workspace's stored transport, whether a chat agent runs, and
its last `SessionInfo` (kept after exit), so a view mounted after a reload, or after the agent
started, shows the chat. In the renderer `agentChat/liveBridge` turns `SessionInfo.busy` and open
approval/question rows into the board's activity, the live store's ask, and the same
notifications a terminal agent's hooks and quiet timer give. The Inbox shows a chat agent's open
prompts as their chat cards (answered over stream-json; 1–9 pick an approval option) and its reply
box sends a chat message (or, with an approval open, denies it with the text as the reason). The
orchestrator's `send_to_agent` / `broadcast_to_agents` and the session tools' `send_to_session`
send chat messages to chat agents; `read_session` returns the end of the conversation.

**Restart and "Open in terminal".** The `…` menu of a ticket or session has *Restart agent*, and
*Open in terminal* (chat agent) or *Open as chat* (terminal agent, brand with a chat adapter).
Each is: stop, wait until the process is gone (`agentChat/switch.ts`), start again on the chosen
transport. Both transports key the conversation by workspace (`claude::conversations`), so the
start `--resume`s it. That holds for Claude only: a Codex chat agent's thread
(`codex-threads.json`) isn't one its TUI can resume, so Codex isn't offered the move. Switching
is only offered while the agent is idle (not mid-turn, nothing
waiting on an answer). The chat journal covers only what ran as a chat; turns taken in the
terminal aren't replayed into it.

## Model, effort and permission mode

The composer's pickers (`agentChat/AgentOptionPickers`) set a workspace's options
(`agent_session::options`, kept in `agent-options.json`; `set_agent_option`). There are two:
one pill for the model and its effort ("Opus 5.5 · High", just "Opus 5.5" at the default
effort), whose menu has a Model and an Effort section, and the permission mode, a glyph
naming the mode before its word (a hand for Ask, the edit pencil for Accept edits, the Plan
tab's glyph for Plan, a shield with an alert for Full access). Claude model ids read as names
(`claude-opus-5-5-20261001[1m]` → "Opus 5.5 1M"; `agentOptionsFormat.modelLabel`); any other
model, a provider's or Codex's, shows as its id. When a provider pins the model, only the
Model section is greyed, with why; effort still changes. A narrow composer collapses them in
steps instead of truncating (`agentOptions.css`, the composer is the size container): the
mode becomes its glyph, then the pill drops its effort, then the pill becomes a sliders
glyph; the tooltips and accessible names keep the values. Every start
honours them: Claude gets `--model`, `--effort` and `--permission-mode`, and Settings' flags they
replace (`--model`, `--effort`, `--permission-mode`, `--dangerously-skip-permissions`) are dropped;
a provider still pins its model. A running agent gets the change at once where its CLI allows:

| | Model | Effort | Mode |
| --- | --- | --- | --- |
| Claude (2.1.319, probed) | `set_model` control request (answers the resolved id) | `apply_flag_settings` `{effortLevel}` | `set_permission_mode` (answered, plus a `system` `status`) |
| Codex (app-server) | `turn/start` `model` | `turn/start` `effort` (`max` → `xhigh`) | `turn/start` `approvalPolicy` + `sandboxPolicy`; no plan mode |

Claude refuses `bypassPermissions` unless it started with `--allow-dangerously-skip-permissions`,
so a local chat Claude always gets that flag (it bypasses nothing by itself). Codex's overrides go
with the next message and every one after. `SessionInfo` carries `effort`, `permissionMode` and
`provider`: Claude's from its answers, `init` and `status`; Codex's from `thread/start` and the
overrides. A stopped agent's pickers show what its next start uses.

## The Codex adapter, as built

`agent_session::codex`, built against codex-cli 0.147.0 (`codex app-server generate-ts
--experimental` for the types, recordings in `codex/fixtures/`). One `codex app-server` per
agent, JSON-RPC over stdio (no `jsonrpc` field on the wire), threaded like the Claude adapter.
`brands` picks the adapter by the start's `cli` ("claude" when unset); `brands::supports_chat`
/ `CHAT_BRANDS` say which brands run as chat.

- Handshake: `initialize` (with `experimentalApi`, for approvals' `availableDecisions`), then
  `initialized` and `thread/start`, or `thread/resume` (`excludeTurns`) of `spec.resume` or the
  workspace's saved thread (`codex-threads.json`, apart from Claude's `sessions.json`). A resume
  Codex refuses with "no rollout found" (no turn ever ran) starts a fresh thread. The thread id is
  `SessionInfo.conversationId` and is saved as it arrives.
- Settings → Agents flags are the TUI's, which app-server doesn't take: `-m`, `-a`, `-s`,
  `--full-auto`, `--yolo` become the thread's `model` / `approvalPolicy` / `sandbox`; `-c`,
  `--enable`, `--disable` go to app-server; anything else is dropped with a warning row. With no
  flags the user's `config.toml` decides, as for a terminal Codex. trace's MCP tools come as
  `-c mcp_servers.trace.*` overrides, the same for the TUI (`claude::launch::codex_wiring`,
  `agent_tools::codex`): a streamable-HTTP `url`, the `X-Trace-Workspace` header, the token in the
  agent's env (`bearer_token_env_var`, never in args or `config.toml`), approval mode `approve`
  and a 200 s tool timeout. The server's instructions go in as `developer_instructions` unless the
  user's `config.toml` sets its own. Hooks aren't wired for Codex yet; the render bridge env is.
- A message is `turn/start` (text, pictures as `localImage`, other files named by path), or
  `turn/steer` into the running turn; before the thread is up it waits. Interrupt is
  `turn/interrupt`, sent once Codex has named the turn.

| Codex sends | Row |
| --- | --- |
| `item/agentMessage/delta`, `item/reasoning/*Delta` | `message` (assistant / reasoning), streaming until `item/completed` |
| `commandExecution` item | `tool` "shell", input `{command, cwd}` (the parsed command, not the `powershell -Command` wrapper), output `aggregatedOutput` capped |
| `fileChange` item | `tool` "apply_patch" (input in apply_patch form, so the view names the files), plus a `diff` per file once applied: add → `after`, delete → `before`, update → `patch` |
| `mcpToolCall`, `dynamicToolCall`, `webSearch`, `imageView` items | `tool` `mcp__<server>__<tool>`, the tool's name, `web_search`, `view_image` |
| `turn/plan/updated` | `plan`, one per turn |
| `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` | `approval`: Codex's `availableDecisions` (accept → allow once, acceptForSession and exec-policy / network amendments → always, cancel → "Deny and stop"), plus `decline` ("Deny", the turn goes on) when Codex didn't list it; answered with the request's response |
| `item/tool/requestUserInput` | `question`, answered as `{answers: {id: {answers}}}` |
| `serverRequest/resolved` for a prompt still open | that prompt cancelled |
| `turn/completed` | `turn` with Codex's `durationMs`; usage is the sum of each request's `thread/tokenUsage/updated` `last` (cached input split out); Codex reports no cost |
| `error` | `status` (a warning while Codex retries; otherwise an error, once, with the API's own message) |
| `warning`, `configWarning`, `deprecationNotice` | `status` warning, each text once |
| `account/rateLimits/updated` | `SessionInfo.limits`, windows named by length (`five_hour`, `seven_day`) |

Other server requests are answered at once (MCP elicitation declined, extra permissions not
granted, dynamic tool calls failed, the rest a JSON-RPC error) so Codex never waits on one.
Sub-agents (`multi_agent`, `codex/translate/agents.rs`): a `collabAgentToolCall` `spawnAgent`
item is a `tool` "spawn_agent" with a `subagent` (its description from the prompt's first line);
its `receiverThreadIds` name the sub-agent's thread, whose notifications (on the same connection)
become rows with `parentCallId` = the spawn's item id; that thread's `turn/completed` (or a
`wait`'s `agentsStates`) ends it, its last message the `result`. `wait`, `sendInput`,
`resumeAgent`, `closeAgent` are tools `wait_agent`, `send_input`, `resume_agent`, `close_agent`.
Interrupt also sends `turn/interrupt` to each running sub-agent's thread, and stopping one sends
it to that one's (`subagents.jsonl`). Other threads' notifications are dropped. Not mapped yet: a denial's note (Codex's decline carries none), hooks,
context-window size, Codex's own slash commands.

## The chat view

`src/domains/agentChat/`, shared by ticket agents and sessions:

- Rows group into turns; a finished turn folds its tool activity behind its answer. Folding
  only hides items: every item keeps its key from its first row on, so nothing remounts when a
  turn ends, and no disclosure's default depends on live state (a box that opened while a call
  ran and closed between calls was the subagent flicker), so nothing opens or closes by itself.
- Subagents (`subagents.ts`, `SubagentCard`, `SubagentView`, `subagentPanel.tsx`): the main
  timeline shows one card per subagent where its call was (type, description, status, time,
  calls, its latest step, then its report) that changes in place and never folds; clicking it
  shows the subagent's tab. Each subagent is a tab in the detail's pane strip, placed right after
  its agent's tab (and its earlier subagents, in start order) when it starts, without taking the
  view; the agent and its subagents read as one run, the strip's divider after the last. A
  finished one's × (or middle-click, or its menu) hides it; its card brings it back. Ctrl+Shift+]
  / [ (⇧⌘] / [, rebindable) step through the agent's tab and its subagents'. A tab is the
  subagent's whole conversation, read-only, under a fact strip the height of the chat's header
  (`SubagentBar`: back to the agent, its label, state, time, calls, Open beside, Stop): brief,
  thinking, messages, calls with output and diffs, report. No composer there; you talk to the
  agent on its own tab. Open beside moves the tab to a pane of its own.
- Tool calls pair with their output and show one summary line, expanding to the detail.
- Diff cards, plan cards, and inline approval and question cards answered in place.
- Assistant text streams in and renders as Markdown, with file links that open in an editor.
- A composer: Enter sends; during a turn it steers it (`hooks/useDeliver`). ⌥Enter queues the
  message for when the turn ends (queued ones are editable, and Send now puts one into the running
  turn), ⌘Enter / Ctrl+Enter interrupts the turn and sends it first. The send button's caret lists
  the three while the agent works. `/` lists the agent's slash commands.
- Stopping: while anything runs (a turn, or subagents after it) the last row is "Working…" with
  the subagent count and Interrupt, and Esc interrupts wherever focus is while the chat is on
  screen (not from another text box or with a menu open; `hooks/useChatKeys`). A running
  subagent's card and tab have Stop (that one only). The header's Stop agent ends the process.
- The header shows model, context and cost from `turn` rows and `SessionInfo`.

## Build order

1. The contract (this doc and the journal types).
2. In parallel: the runtime with the Claude adapter, and the chat UI against fixture journals.
3. The Codex adapter. 4. The transport setting, "Open in terminal" and resume (done; see above).
5. ACP.

Adding a brand: its adapter, then one entry in `brands::CHAT_BRANDS` and one arm each in
`brands::launch`, `brands::wiring` and `brands::resumable`. The renderer asks
`chat_agent_brands`, so its menus and Settings follow.

## Prior art

- **Orca** runs agents in structured mode (Claude through the Agent SDK, Codex through
  `app-server`, others through ACP) into one journal, and in bridge mode (a PTY, with the chat
  rebuilt from transcript files). trace's terminal transport is the bridge; this adds the
  structured one.
- **claude-orchestrator** ran Claude headless, one process per message, and showed tool calls as
  one-line activity summaries without results. It moved to the PTY for billing reasons that the
  probe above no longer shows.
