# Issue-provider rules (Jira, Pylon, …)

The board is **provider-agnostic**. Several providers can be connected at once: `AppState.providers`
maps each `ProviderKind` to its `issues::Provider` connection, and every board command takes the
target provider as an argument. Each provider implements `issues::IssueProvider`
(`src-tauri/src/issues/mod.rs`): `current_user`, `list_boards`, `get_board`, `transition_issue`,
`add_comment`, `list_comments`, `get_pull_requests`, `session_info`.

## Shared shapes

- Frontend-facing models live in `issues/models.rs` (mirrored in `src/domains/issues/types.ts`) —
  provider parsers map their raw payloads into them. Board ids are **opaque strings** (Jira's are
  numeric; Pylon's are virtual, e.g. `open-issues`).
- Status categories are normalized to `new` | `indeterminate` | `done` so the frontend never
  hardcodes column names or provider-specific states.

## Auth & persistence

- Each provider owns an `auth.rs` (validate + `0600` config-file save/load/clear). Tokens **never**
  cross to the renderer and are never logged.
- `issues/session.rs` restores every saved provider on launch (`restore_all`). Disconnecting a
  provider removes only its credential file.
- A tracker is optional. The Integrations page (`domains/integrations/`) connects and disconnects each
  independently. A tracker's pages are only in the rail while it's connected (`app/nav.ts`), and the
  app lands on Sessions with none.

## REST or MCP: choosing the adapter

A tracker can have two adapters: its REST API (a saved key) and its MCP server (trace's own
`mcp_auth` login). Both are the same `ProviderKind`, so `AppState.providers` still holds one
connection per tracker. `issues/mcp_link.rs` holds the rule and the record:

- **Saved API credentials win.** Else a `<tracker>-mcp.json` record (`McpLink`: server URL, and for
  Jira the site's cloudId, URL and name; no token) **plus** a login to that server → the MCP
  adapter. A record without a login is not connected (logging in again brings it back).
- `connect_<tracker>_mcp` (`commands/issues_mcp.rs`) logs in through `mcp_auth::flow` if needed,
  validates with `current_user`, saves the record, and only then deletes the API credentials.
  Connecting by API key clears the record. Disconnecting clears both, never the MCP login
  (agents use it).
- A new MCP adapter plugs in with a `from_link(&McpLink)`, one `mcp_link::restore` arm in
  `session::restore_all`, a connect command, and a `login` way in `domains/integrations/registry.ts`
  (the dialog's `TwoWayConnect` offers it beside the token form).

## Pylon specifics

- Bearer-token auth; validate with `GET /me`. API base `https://api.usepylon.com`.
- No boards/sprints: a single virtual board (`open-issues`), which appears
  on its own Pylon page in the rail (frontend namespaces board keys as `${provider}:${boardId}`). Columns = base states (`new`,
  `waiting_on_you`, `waiting_on_customer`, `on_hold`, `closed`) plus custom status slugs discovered
  on issues (inserted before `closed`, category `indeterminate`).
- Cards come from `GET /issues` over a rolling 30-day window (the API is time-bounded). Closed
  issues are kept only for 14 days — the Closed column shows recent completions, not history.
- Transition = `PATCH /issues/{id}` with `{"state": slug}` (no workflow gates). The API accepts an
  issue number, so the card key `#123` maps directly.
- Comment = `POST /issues/{id}/note` (internal note, `body_html`).
- Thread read = `GET /issues/{id}/messages` (oldest-first, cursor-paginated; `is_private` marks
  internal notes) — powers the `{comments}` placeholder in the agent kickoff brief.
- No dev-status integration → `get_pull_requests` returns empty; the frontend skips PR fan-out for
  non-Jira providers.

## Adding a provider

1. New `src-tauri/src/<name>/` module (connection struct + `auth`/`client`/`models`/`board`),
   implementing `IssueProvider`.
2. Add a variant to `issues::Provider` (+ `ProviderKind`, `session_info`, restore in
   `issues/session.rs`).
3. Add `connect_<name>` in `commands/issues.rs`; register in `lib.rs`.
4. Frontend: add it to `domains/integrations/registry.ts` with a form in `ConnectForms.tsx`, a store
   action in `domains/issues/store.ts`, and its page in `app/nav.ts` and the rail. Types rarely change.
