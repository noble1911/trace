# Jira integration rules

Jira Cloud is the **source of truth** for the board. We never hardcode columns or maintain a local ticket list.

## Auth

- HTTP Basic: `Authorization: Basic base64(email:apiToken)`. User provides `site` (e.g.
  `your-org.atlassian.net`), `email`, and an Atlassian API token.
- Validate a connection with `GET /rest/api/3/myself`. Persist credentials in a user-only (`0600`) file under
  the app config dir (`jira/auth.rs`) so the app reconnects silently on launch. The token **never** crosses to
  the renderer and is **never** logged. (The OS keychain re-prompts on every unsigned dev rebuild — switch back
  to it once release builds are code-signed.)
- The login UI gates the whole board: no valid connection → no board.

## Columns come from the user's board (not the design's 4 columns)

1. Resolve a board: `GET /rest/agile/1.0/board` (if multiple, let the user pick; persist the choice).
2. `GET /rest/agile/1.0/board/{boardId}/configuration` → `columnConfig.columns[]`, each `{ name, statuses[] }`.
   These columns, in order, ARE the board's columns.
3. A card's column = the column whose `statuses` contains the issue's current status id. This is what makes the
   board mirror *their* workflow (TODO/IN PROGRESS/DONE, or whatever they actually have).

## Cards come from the board's open sprints

- Issues are fetched with the Platform search API (`GET /rest/api/3/search/jql`), not the Agile board
  endpoint — the Agile endpoint hides epics. The query ANDs the board's saved filter (resolved from the board
  configuration's `filter.id`) with `sprint in openSprints()`, so the result mirrors exactly what the user's
  board shows minus backlog/closed sprints (`jira/board.rs::fetch_board_issues`).
- All assignees are fetched; the frontend filters by assignee (avatar picker, defaulting to the current user).
- Map each issue → the card model: `key`→id, `summary`→title, priority, labels, status, assignee→avatar,
  description → the Ticket tab.

## Moving a card writes back to Jira

- `GET /rest/api/3/issue/{key}/transitions` → find the transition whose target status maps to the destination
  column; `POST .../transitions` with that id.
- Move the card optimistically in the store, then reconcile against the response. Surface failures (no valid
  transition, permission denied) rather than silently snapping back.

## Conventions

- All Jira HTTP lives in `src-tauri/src/jira/client.rs`; response shapes in `jira/models.rs`; board/sprint logic
  in `jira/board.rs`; PR dev-status in `jira/dev.rs`. Frontend talks to it only through `commands/jira.rs` →
  `src/ipc/jira.ts`.
- Treat the API as paginated: follow `startAt`/`isLast` on Agile endpoints and `nextPageToken` on
  `/search/jql` — a single-page fetch silently truncates large orgs.
