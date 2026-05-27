# Jira integration rules

Jira Cloud is the **source of truth** for the board. We never hardcode columns or maintain a local ticket list.

## Auth

- HTTP Basic: `Authorization: Basic base64(email:apiToken)`. User provides `site` (e.g.
  `your-org.atlassian.net`), `email`, and an Atlassian API token.
- Validate a connection with `GET /rest/api/3/myself`. Store credentials in the **OS keychain** (`keyring`
  crate) keyed by site. The token **never** crosses to the renderer and is **never** logged.
- The login UI gates the whole board: no valid connection → no board.

## Columns come from the user's board (not the design's 4 columns)

1. Resolve a board: `GET /rest/agile/1.0/board` (if multiple, let the user pick; persist the choice).
2. `GET /rest/agile/1.0/board/{boardId}/configuration` → `columnConfig.columns[]`, each `{ name, statuses[] }`.
   These columns, in order, ARE the board's columns.
3. A card's column = the column whose `statuses` contains the issue's current status id. This is what makes the
   board mirror *their* workflow (TODO/IN PROGRESS/DONE, or whatever they actually have).

## Cards come from the current sprint

- Scrum board: `GET /rest/agile/1.0/board/{boardId}/sprint?state=active` → active sprint id, then
  `GET /rest/agile/1.0/sprint/{sprintId}/issue?jql=assignee = currentUser()`.
- Kanban board (no sprints): `GET /rest/agile/1.0/board/{boardId}/issue?jql=assignee = currentUser()`.
- Map each issue → the card model: `key`→id, `summary`→title, priority, labels, status, assignee→avatar,
  description/subtasks → the Ticket tab.

## Moving a card writes back to Jira

- `GET /rest/api/3/issue/{key}/transitions` → find the transition whose target status maps to the destination
  column; `POST .../transitions` with that id.
- Move the card optimistically in the store, then reconcile against the response. Surface failures (no valid
  transition, permission denied) rather than silently snapping back.

## Conventions

- All Jira HTTP lives in `src-tauri/src/jira/client.rs`; response shapes in `jira/models.rs`; board/sprint logic
  in `jira/board.rs`. Frontend talks to it only through `commands/jira.rs` → `src/ipc/` → `domains/jira/api.ts`.
- Treat the API as paginated; handle `maxResults`/`startAt` where Jira returns it.
</content>
