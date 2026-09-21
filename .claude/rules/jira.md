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
- The login UI gates the whole board: no valid connection → no board.

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
