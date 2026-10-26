---
name: trace-ui
description: trace's design language — tokens, the three control sizes, which control to use for what, where panels go, how agent state is drawn. Load before any change to trace's UI (components, CSS, layout, a new screen or control), and use its checklist before calling UI work done.
---

# trace UI

trace is a dense, dark, keyboard-friendly tool for supervising many agents at once.
Its UI should read as **one system**: same heights, same corners, same words, and
colour reserved for state. When a screen looks "off", it is almost always one of the
rules below being broken — fix it by applying the rule, not by tuning pixels.

Tokens live in `src/styles/tokens.css`. **Never hardcode a hex, oklch or px value a
token already names** — in CSS or inline styles.

## 1. Controls: three heights, one corner

Every interactive control is one of three heights, so any row of them lines up:

| Token | Size | Used for |
|---|---|---|
| `--control-h` | 30px | buttons, icon buttons, split buttons, a header's status pill |
| `--control-h-sm` | 26px | filter chips, segmented controls, toolbar filters |
| `--control-h-xs` | 20px | pills inside cards and list rows (status, PR, counts) |

Controls use `--radius-sm` (6px). Cards use `--radius` (10px); columns and panels
`--radius-lg` (14px). Only *state* pills are fully round (999px) — and in a header
even they take the control's height and corner (`StatusLight size="lg"`).

**Which control:**

- **`.btn`** — any action. One `.btn.primary` per region at most. `.btn.success`
  for merge, `.btn.danger` for destructive, `.btn.primary-needs` for answering an
  agent that needs you.
- **`.btn.icon`** — icon-only action, square (`--control-h`), always `aria-label`
  (e.g. `MoreTrigger` "…").
- **No panel toggles in headers.** A side panel's own strip is its toggle (§3).
- **`.btn.ghost`** — only in dense in-content toolbars (Refresh, Reset order). Never
  in a header row beside bordered buttons — that's what made headers look mixed.
- **`.seg`** — mutually exclusive view options (card density).
- **`.filter-chip`** — a toggleable filter.
- **`.kbd`** — a keyboard hint inside a button or hint row.

## 2. Agent state is drawn one way: `StatusLight`

`src/components/StatusLight.tsx` + `status-light.css`, fed by the live store
(`domains/live`). Four states, four colours, same words everywhere:

| State | Token | Look | Word |
|---|---|---|---|
| attention | `--state-needs` (amber) | blinking dot | **Needs you** — or the ask: "Permission · Bash", "Question", "Plan approval" |
| working | `--state-working` (blue) | spinner | **Working** |
| ready | `--state-ready` (green) | solid dot | **Ready** |
| stopped | `--state-stopped` (grey) | hollow ring | **Stopped** |

Variants: `dot` (tabs, compact lists), `word` (list rows), `pill` (cards, rows,
inbox), `pill` + `size="lg"` (detail headers). Never draw agent state with ad-hoc
text or colour (`.thinking`/`.waiting` are legacy). Tracker status (To do / In
review) is `<StatusPill>` — a different thing; don't mix them.

**Colour means state.** Amber/blue/green are reserved for agent state. Violet
(`--c-accent`) is the brand: focus rings, selection, drop indicators, epics. PR and
CI state use outlined `.pr-pill` chips so a green check never reads as "agent ready".
Diff `+`/`−` use `--state-ready` / `--c-danger`.

## 3. Layout: left navigates, right explains

```
┌──────┬───────────────────────────────────────────┬─────────────┬──┐
│ rail │ topbar / page or detail                    │ side panel  │  │
│ 56px │                                            │ PRs | Orch. │  │
│ ⌂    │                                            │  — or —     │▕ │ ← folded strip,
│ ◉ ── ┼─▶ recents flyout (rest on Sessions)        │             │  │   vertical label
│      │                                            │             │  │
└──────┴───────────────────────────────────────────┴─────────────┴──┘
```

- **Left = navigation, and it lives in the rail.** The rail is 56px of icons and
  badges. A view's own navigation (recent sessions) is a flyout from that view's
  rail button while the view is selected: resting on the button slides a named
  list out beside the rail after a short delay (~350ms), and it slides back as soon
  as the pointer leaves (`RailRecents`, `.rail-group`). Don't also show the same
  items as icons — one surface per job. No columns docked beside the rail.
- **Right = the helper beside your work**: one `<SidePanel>` (`components/SidePanel`)
  docked on the window's right edge, showing **one view at a time**:

  | Where | Views |
  |---|---|
  | Session | Pull requests (once it has one) · Orchestrator |
  | Ticket | Details (PRs, workspace, ticket) · Orchestrator |
  | Board, Sessions page | Orchestrator (`app/PagePanel`) |
  | Inbox, Fleet, others | none — they have their own detail area, or don't need it |

  It slides in from the side. Open, its header has a tab per view; closed, it folds
  to a `--side-w-closed` strip naming each view vertically (with counts) — clicking
  a name opens that view, so the strip *is* the toggle. State comes from
  `useSidePanel(place, views)`: each place remembers open/closed and its view; a
  remembered view that isn't available (a session with no PR) leaves it folded.
  ⌘J shows/folds the orchestrator in whichever panel is in front (a detail's beats
  its page's). Render it as the last child of `.detail` or `.main`; they pad
  themselves clear of it. Nothing floats over content — no FABs or floating windows.
- **Never two pull-out panels**, and never panels on both edges for the same view.
  A new list of "things to jump to" goes in the rail; facts about the current thing
  go in the right panel.

**Detail header** (`.detail-top`), left to right:
`← <page it returns to> esc` · identity (mono key, title at `--text-detail-title`) ·
*right group:* status (`StatusLight size="lg"`) → primary action → secondary
actions → `…` (`MoreTrigger`). All `--control-h`, gap 8px. The side panel's toggle
is its own strip, never a header button.

**Pages** (`.page` / `.page-head`): `h1` at `--text-title`, a one-line `.desc`, actions
right-aligned. Tab bars use `.detail-tabs`. Esc closes a detail (not from inside a
terminal or while a modal/menu is open); ⌘1–9 switch its tabs.

**Lists of agents** keep a stable order (opened order, or the user's drag): state
changes recolour a row, never move it. Reorderable rows show `I.Grip`; ⌥↑/⌥↓ does
the same from the keyboard.

## 4. Type, space, icons

- Type tokens: `--text-title` 18 · `--text-detail-title` 15 · `--text-body` 13.5 ·
  `--text-ui` 12.5 · `--text-meta` 11.5 · `--text-label` 10.5. Section labels are
  `--text-label`, uppercase, `letter-spacing: 0.08em`, `--fg-3`.
- `--font-mono` for keys, ids, branches, paths, counts, ages and diffs; Geist for
  everything else.
- Text colour: `--fg-0` titles, `--fg-1` body, `--fg-2` secondary, `--fg-3` meta.
  `--fg-4` is ~3:1 on the dark surfaces — decoration and disabled only, never text
  someone has to read.
- Spacing steps 4 · 6 · 8 · 10 · 12 · 16 · 20; rows 36–46px; card padding 10×12.
- Icons: `I.*` from `components/Icon.tsx` only, 13–16px, stroked — add a glyph
  there rather than inlining SVG. One meaning per glyph (Sparkles = AI). No emoji.

## 5. States and affordances

- Empty: a dashed box with one plain sentence that says what would fill it
  (`.ib-empty`, `.col-empty`, `.fl-empty`); full-page ones use `.empty-state`.
- Anything hover-revealed also has a visible or keyboard path (an always-visible
  Start, a row's open arrow as well as double-click).
- Destructive actions confirm inline (Cancel / Confirm buttons), not with a dialog.
- Errors go to `toast.error` with the reason, not a bare red line.

## 6. Where code goes

- Shared primitives (`StatusLight`, `SidePanel`, `Modal`, `PopMenu`, `Icon`) live in
  `src/components/`; reuse them before writing a look-alike.
- A domain's CSS lives in its folder and is imported once in `src/main.tsx`; class
  names are prefixed per domain (`ib-`, `fl-`, `rs-`). Keep CSS files under the
  ~400-line cap like everything else.
- Inline `style={{}}` only for genuinely dynamic values (a width, a computed colour).

## Before you call UI work done

- [ ] Every control in a row shares a height token and `--radius-sm`.
- [ ] Agent state uses `StatusLight`; colour appears only for state, accent or diff.
- [ ] No new raw hex/oklch/px where a token exists; titles use the type tokens.
- [ ] Navigation is in the rail, context in the right-edge `SidePanel`, one side panel at most.
- [ ] Icon-only buttons have `aria-label`; hover-only actions have another path.
- [ ] Empty and error states say something useful.
- [ ] `npx tsc --noEmit` and `npx @biomejs/biome check src` pass.

Legacy to migrate when you touch it (don't copy): raw `font-size` px values,
inline `oklch(... / alpha)` literals, `.thinking`/`.waiting`, and `--c-prog`/`--c-warn`
for agent state.
