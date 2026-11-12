# Boards plan: trackers over MCP, and custom boards

Three things, one shape:

1. **Jira and Pylon boards can run over the tracker's MCP server** (trace's own OAuth
   login, `mcp_auth`), not only an API key. Rule: an API key, if saved, is used;
   otherwise the MCP login.
2. **Custom boards**: boards the user makes in trace, with their own columns and
   cards, that start agents and move cards like any other.
3. **trace's agent tools cover every board**: list boards, read any board and its
   columns, move a card on any of them (custom included), make cards on a custom one.

Side item: the orchestrator's model picker uses the models Claude Code reports
(`claude/catalog.rs`, `ipc/claudeCatalog.ts`), like the agent pickers.

Second side item: **trace keeps the computer awake while an agent is running** (the
display may still sleep), on by default, with a switch in Settings. A new port,
`platform::keep_awake`, with an adapter per OS: macOS runs `caffeinate -i -w <trace's
pid>` (so it can never outlive trace), Windows `SetThreadExecutionState`, Linux
`systemd-inhibit` when present (else nothing). Domain code only says "hold" and
"release", from the count of live agents.

## Ports and adapters

The board never knows where its data comes from.

```
                     issues::IssueProvider            (the port; unchanged shape)
        ┌──────────────┬───────────────┬──────────────┬──────────────┐
   jira/ (REST)   jira_mcp/ (MCP)   pylon/ (REST)  pylon_mcp/ (MCP)  custom_boards/ (local file)
                       │                               │
                       └────── mcp_client::ToolCaller ─┘   (second port: "call tool X with JSON")
                                      │
                         mcp_client::http (streamable HTTP, auth from mcp_auth)
```

- `ProviderKind` is the *tracker*: `Jira | Pylon | Custom`. It is what the frontend,
  the rail and card keys know.
- `Provider` is the *connection* (the adapter): `Jira`, `JiraMcp`, `Pylon`,
  `PylonMcp`, `Custom`. `kind()` maps both Jira adapters to `ProviderKind::Jira`, so
  `AppState.providers` still holds one connection per tracker and nothing above the
  port changes.
- `ProviderSession` gains `via: "api" | "mcp" | "local"` (display only).
- The MCP adapters depend on `mcp_client::ToolCaller` (a trait: `call(tool, args) ->
  Value`, `tools() -> names`), never on HTTP. Their tests use a fake caller with
  recorded payloads. The HTTP implementation is the only place that knows MCP's wire
  format.
- Each MCP adapter keeps tool names and argument shapes in one file (`tools.rs`) and
  payload parsing in another (`parse.rs`), producing `issues::models`. On connect it
  checks the tools it needs exist and fails with a sentence naming what's missing.
- No OS-specific code; persistence through `helpers::persist`; files under the size
  cap; thin commands. See `.claude/rules/`.

## Choosing the adapter

`issues/session.rs::restore_all`, per tracker: saved API credentials → REST adapter;
else an `mcp_auth` grant for that tracker's MCP server (Atlassian v2
`https://mcp.atlassian.com/v2/mcp`; Pylon US/EU) plus a saved "use for the board"
record → MCP adapter. Connecting by API key replaces an MCP connection and vice
versa. Commands: `connect_jira_mcp()`, `connect_pylon_mcp()` (log in through
`mcp_auth::flow` if there's no grant, validate with `current_user`, save the record).
Disconnecting the tracker removes the record, not the MCP login agents use.

## Custom boards

- Adapter `custom_boards/`: `store.rs` (`custom-boards.json` via `helpers::persist`),
  `model.rs`, `mod.rs` (implements `IssueProvider`), `edit.rs` (mutations).
- A board: `{ id, name, columns: [{ id, name, category }], cards, nextNumber }`.
  A column is one status (its id is the status id); `category` is `new` |
  `indeterminate` | `done`, so auto-start and cleanup work without column names.
  New boards start with To do / In progress / Done.
- A card is an `Issue`: key `local-<n>` (one counter across all custom boards),
  summary, description, priority, labels, column, comments (stored with the card).
  `local-` is lowercase, so it can't be a Jira key (`ABC-123`) or a Pylon one (`#123`):
  `ProviderKind::for_issue_key`, `activity::looks_like_issue_key`, the frontend's
  `trackerForIssueKey` and the agent's context (`claude/context.rs`: "card local-12 on
  trace board <name>") learn it. Agent tools must stop upper-casing keys blindly.
- Always connected: `restore_all` always includes `Provider::Custom`; it has no login.

### IPC contract (fixed here so backend and frontend build in parallel)

Existing board commands work with `provider: "custom"` (`list_boards`, `get_board`,
`transition_issue`, `comment_on_issue`, `list_issue_comments`). New commands
(`commands/custom_boards.rs`, wrappers in `src/ipc/customBoards.ts`), each returning
the board's fresh `BoardData` unless noted:

| Command | Args | Returns |
|---|---|---|
| `custom_board_create` | `name` | `BoardSummary` |
| `custom_board_rename` | `boardId, name` | `()` |
| `custom_board_delete` | `boardId` | `()` (refused while a card's agent runs) |
| `custom_column_add` | `boardId, name, category` | `BoardData` |
| `custom_column_update` | `boardId, columnId, name?, category?` | `BoardData` |
| `custom_column_move` | `boardId, columnId, toIndex` | `BoardData` |
| `custom_column_delete` | `boardId, columnId, moveCardsTo?` | `BoardData` (refused with cards and no target) |
| `custom_card_create` | `boardId, summary, description?, columnId?, priority?, labels?` | `Issue` |
| `custom_card_update` | `key, summary?, description?, priority?, labels?` | `Issue` |
| `custom_card_delete` | `key` | `()` (refused while its agent runs) |

`BoardData`/`Issue`/`BoardColumn` are the existing shapes; `boardType` is `"custom"`.

### Frontend

- `ProviderKind` gains `"custom"`; a **Boards** page in the rail (`NavId "boards"`,
  always available) with the switcher listing custom boards (`custom:<id>`) and
  "New board…". It reuses the Board/Column/Card components; a custom board adds: add
  card (per column), edit/delete card (card menu + ticket view), add/rename/recolour
  (category)/reorder/delete column, rename/delete board. Follow the `trace-ui` skill.
- Integrations: Jira's and Pylon's cards offer "Connect with your login (MCP)" beside
  the API token, and show which is in use.

## Agent tools (trace's MCP, `domains/agentTools` + `domains/orchestrator`)

- `list_boards`: every board of every connected tracker and every custom board:
  `provider:boardId`, name, type, which is shown now.
- `get_board` takes an optional `board` (`provider:boardId`); without it, the shown
  board. Output states each column with its statuses and categories.
- `move_issue`, `comment_on_issue`, `get_ticket_details`, `start_agent` work for a key
  on a board that isn't shown (resolve the tracker from the key; fetch that board).
- New, custom boards only: `create_card`, `update_card`. Board and column structure
  stays the user's.
- `rpc::INSTRUCTIONS` says so in a sentence.

## Delivery

| # | Package | Depends on | Model |
|---|---|---|---|
| A | `mcp_client/`: `ToolCaller` port, streamable-HTTP client, live tool-listing test | – | opus |
| B | `custom_boards/` adapter, `ProviderKind::Custom`, key rules, commands | – | opus |
| E | Boards page and custom-board editing UI | B's contract | opus |
| H | Orchestrator model picker from Claude's catalog | – | sonnet |
| I | Keep the computer awake while agents run (`platform::keep_awake` + setting) | after B (shares the Rust tree) | sonnet |
| C | `jira_mcp/` adapter, adapter choice, connect commands, Integrations UI | A | opus |
| F | Agent tools for every board | B, E | sonnet |
| D | `pylon_mcp/` adapter | A, C; Pylon's real tool list | opus |
| R | Review of the whole diff, then fixes | all | fable |

Verification each package runs: `cargo test`, `cargo fmt`, `npx tsc --noEmit`,
`npx @biomejs/biome check src`, `npm test`. MCP adapters also need one live run
against a real login (`cargo test <name>_live -- --ignored`), which needs the user to
connect that server in trace once.

## Appendix: the MCP tools each adapter maps to

Names are from the vendors' docs (2026-11-12). Neither documents argument schemas:
read them from the server's `tools/list` (the live test in package A prints them)
before fixing argument names, and keep them in the adapter's `tools.rs`.

**Atlassian Rovo MCP v2** (`https://mcp.atlassian.com/v2/mcp`; `?tools=all` lists
every tool, otherwise most are reached through `discover` / `executeRead` /
`executeWrite`): `getAccessibleAtlassianResources` (cloudId), `getJiraCurrentUser` /
`atlassianUserInfo`, `listJiraBoards`, `getJiraBoardConfig` (filter, columns, status
mappings), `getJiraBoardIssueData`, `getJiraBoardSprintData`, `listJiraBoardSprints`,
`searchJiraIssuesUsingJql`, `getJiraIssue`, `listJiraIssueTransitions`,
`transitionJiraIssue`, `listJiraIssueComments`, `addOrEditJiraIssueComment`,
`getTeamworkGraphContext` (linked PRs; optional: empty list if absent).

**Pylon** (`https://mcp.usepylon.com`, EU `https://mcp.eu.usepylon.com`; streamable
HTTP, stateless): `get_me`, `search_issues` (`filter_json` from `build_filter`,
`cursor`, `has_next_page`), `get_issue` (by id or number), `update_issue` (status
among its fields), `send_issue_note` (internal; never `send_issue_reply`, which goes
to the customer), `get_issue_messages`, `get_issue_statuses`, `search_users`.
