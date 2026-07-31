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
- The login UI (`domains/issues/components/ProviderLogin.tsx`) gates the app until at least one
  provider is connected; Settings → Integrations connects/disconnects each independently.

## Pylon specifics

- Bearer-token auth; validate with `GET /me`. API base `https://api.usepylon.com`.
- No boards/sprints: a single virtual board (`open-issues`), which appears in the board switcher
  alongside Jira boards (frontend namespaces board keys as `${provider}:${boardId}`). Columns = base states (`new`,
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
4. Frontend: add the connect form to `ProviderLogin.tsx`, a store action in
   `domains/issues/store.ts`, and an integration card in Settings. Types rarely change.
