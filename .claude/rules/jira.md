# Jira integration rules

Jira Cloud is one issue provider behind `issues::IssueProvider` — see `.claude/rules/providers.md` for the
abstraction. Jira specifics follow. We never hardcode columns or maintain a local ticket list.

## Auth

- HTTP Basic: `Authorization: Basic base64(email:apiToken)`. User provides `site` (e.g.
  `your-org.atlassian.net`), `email`, and an Atlassian API token.
- Validate a connection with `GET /rest/api/3/myself`. Persist credentials in a user-only (`0600`) file under
  the app config dir (`jira/auth.rs`) so the app reconnects silently on launch. The token **never** crosses to
  the renderer and is **never** logged. (The OS keychain re-prompts on every unsigned dev rebuild — switch back
  to it once release builds are code-signed.)
- No valid connection → the Board page isn't in the rail (nor Jira's boards in the grouped Boards button), and
  Pull requests lists only sessions' and ticket workspaces' PRs.

## Columns come from the user's board (not the design's 4 columns)

1. Resolve a board: `GET /rest/agile/1.0/board` (if multiple, let the user pick; persist the choice).
2. `GET /rest/agile/1.0/board/{boardId}/configuration` → `columnConfig.columns[]`, each `{ name, statuses[] }`.
   These columns, in order, ARE the board's columns.
3. A card's column = the column whose `statuses` contains the issue's current status id. This is what makes the
   board mirror *their* workflow (TODO/IN PROGRESS/DONE, or whatever they actually have).

## Cards are exactly what the board shows

- Issues are fetched with the Platform search API (`GET /rest/api/3/search/jql`), not the Agile board
  endpoint — the Agile endpoint hides epics, which would empty an epic board. `jira/scope.rs` builds the
  query so the result matches the board view card for card (verified against `xboard/work/allData.json` on
  every board of the dev instance):
  - the board's **saved filter** (from the configuration's `filter.id`), ANDed with
  - a Kanban board's **sub-filter** (`subQuery`, e.g. unreleased versions),
  - `sprint in openSprints()` **only** on a sprint board that has one running — a Scrum board between
    sprints shows its filter rather than an empty board,
  - `status not in (…)` for the **Kanban backlog column**, which Jira keeps on its separate Backlog screen
    (that column is dropped from the board's columns too, as is any column with no statuses),
  - the board's **"hide completed issues older than"** cutoff, as
    `(statusCategory != Done OR statusCategoryChangedDate >= -1w)`. Without it a long-lived Kanban board
    returns thousands of done issues (PM Delivery: 3026 → 205).
- The cutoff, the backlog column and sprint support are **not in the public Agile API**: they come from the
  board-config screen Jira's own UI uses (`/rest/greenhopper/1.0/rapidviewconfig/editmodel.json`), which
  needs board-admin rights. Every read is best-effort — on failure `scope::BoardSettings::defaults` applies
  Jira's own defaults per board type (scrum: no cutoff; kanban: `-2w`; team-managed: `-14d`).
- All assignees are fetched; the frontend filters by assignee (avatar picker, defaulting to the current user).
- Map each issue → the card model: `key`→id, `summary`→title, priority, labels, status, assignee→avatar,
  description → the Ticket tab.

## Moving a card writes back to Jira

- `GET /rest/api/3/issue/{key}/transitions` → find the transition whose target status maps to the destination
  column; `POST .../transitions` with that id.
- Move the card optimistically in the store, then reconcile against the response. Surface failures (no valid
  transition, permission denied) rather than silently snapping back.

## Conventions

- All Jira HTTP lives in `src-tauri/src/jira/client.rs`; raw-JSON parsers in `jira/parse.rs` (producing the
  shared `issues::models` shapes); board/sprint logic in `jira/board.rs`; comment fetch in
  `jira/comments.rs`; PR dev-status in `jira/dev.rs`.
  Frontend talks to it only through `commands/issues.rs` → `src/ipc/issues.ts`.
- Treat the API as paginated: follow `startAt`/`isLast` on Agile endpoints and `nextPageToken` on
  `/search/jql` — a single-page fetch silently truncates large orgs.

## Jira over MCP (`jira_mcp/`)

- A second adapter for the same tracker: Atlassian's Rovo MCP v2 server
  (`https://mcp.atlassian.com/v2/mcp?tools=all`) with trace's own OAuth login (`mcp_auth`, the same
  login as Integrations → MCP servers), no API token. `Provider::JiraMcp`, `kind()` = `Jira`,
  `session_info().via` = `"mcp"`, `site` = the site's host (browse links still work).
- Generic over `mcp_client::ToolCaller`; tests run on `FakeCaller` with fixtures in
  `jira_mcp/fixtures/`. Tool names and argument shapes live only in `jira_mcp/tools.rs`; arguments
  are built from each tool's advertised input schema (first listed name wins, values coerced to
  its type), because Atlassian doesn't document v2's argument names. `route.rs` runs unlisted
  tools through `executeRead`/`executeWrite` if the server only shows its `discover` front.
- Same board semantics as REST: columns from `getJiraBoardConfig`, cards from `jira::scope`'s JQL
  (`filter = <id>` when the config has no filter JQL) paged through `searchJiraIssuesUsingJql`
  (`nextPageToken`). The board-config screen isn't reachable, so the done cutoff is
  `BoardSettings::defaults` per board type, as on REST without board-admin rights (a Kanban
  board set to hide done issues after 1 week shows 2 weeks' worth). The Kanban backlog column
  *is* found: `getJiraBoardIssueData` with `dataset: "backlog"` lists the backlog's issues, and
  their statuses name the column to drop.
- What the real server does (checked live 2026-11-12; `v2_tests.rs` encodes it, and
  `cargo test jira_mcp_live -- --ignored --nocapture` re-checks it, printing counts only):
  every answer is under `data` (taken off in one place, `call_with`); a failed Jira call is
  `{ error: true, message }` in a successful result; tools with a `view` answer compactly
  (no status ids) unless asked for `"full"`; content is `markdown` or `html`, never ADF;
  `listJiraStatuses` needs a `mode` and gives names without categories (categories come from
  cards); a transition names its target status without its id, so a move is matched by name
  (`statuses::names`); a board without sprints answers the sprints tool with a 400.
  `jira_mcp_live_shapes` (`live_probe.rs`) prints any read tool's answer as keys and types.
- **Verified live: every read** (sites, user, boards, config, cards, backlog, statuses,
  comments, the list of moves). **Not run live: the two writes** (`transitionJiraIssue`,
  `addOrEditJiraIssueComment`): their arguments follow the server's schemas and are tested on
  `FakeCaller` only. Linked PRs are empty over MCP (v2's `getGraphContext` isn't wired).
- Every call names the site's `cloudId` (`getAccessibleAtlassianResources`; a site listed once per
  product is merged by id, Confluence-only ones are left out). Several sites: the connect asks
  which, and the choice is saved.
- Which adapter is used: `issues::mcp_link` (see `providers.md`).
