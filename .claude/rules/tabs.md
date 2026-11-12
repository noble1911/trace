# Workspace tab rules

A ticket's or session's detail shows its agent beside a row of tabs. The agent's own
tab and Ticket are always there. **Every other tab comes and goes, and they all follow
one rule**, implemented once in `src/domains/panes/coming.ts`. Don't give a tab its
own visibility or close logic: describe its content and let the rule decide.

The tabs under the rule: Plan, Browser, Gallery, Files, Terminal, Tests, Pull request.

## The rule

1. **It shows while it has content.** Each tab says what that means: a plan
   document or task list, a page, an image set, changed files, an open shell, a test
   run, a PR. With nothing in it, it's not in the tab row.
2. **Its × hides it. Nothing is ever deleted.** The content stays as it was: a
   hidden shell keeps running, a hidden test result is kept, documents and pages
   stay. Deleting content is done inside the tab (closing one Browser page, removing a
   Plan version), never by the tab's ×.
3. **New content brings it back by itself.** "New" is a change of the tab's
   *signature*, a string that changes only when something new arrives: a new
   document, page id, set id, change count, test run or PR. An update to what's
   already there (navigating a page, the task list ticking, files landing in a shown
   set) is not new.
4. **The pane menu always lists it** (⋯ → Tabs), with a mark: **filled accent**
   when it has content, shown or hidden; **hollow** when it's empty. Picking a hidden
   tab shows it.
5. **Opening empty is per tab.** A tab that does something with nothing in it
   (Terminal starts a shell, Browser gives an address bar, Gallery offers a folder,
   Files browses the worktree, Tests starts a run) can be picked while empty, and
   shows until its × or its first content. One that only an agent fills (Plan, Pull
   request) is greyed out while empty.
6. **Settings → Tabs turns a tab off** (`panes/tabSettings.ts`): it never shows or
   appears in the menu, and the agent tools that fill it (`publish_document`,
   `open_browser`, `show_images`) aren't offered to agents.

## Adding a tab that comes and goes

1. Work out its **content** (a boolean) and its **signature** (what counts as new).
2. In the hook that builds its state, call
   `useComing(tabId, workspaceId, content, signature)`.
3. In its `PanelDescriptor`, spread `comingFields(coming, opensEmpty)`. That sets
   `hidden`, `comes`, `filled`, `opensEmpty`, `onReveal` and the ×. Override
   `onReveal` only to do something on open (Tests starts a run), and still call
   `coming.reveal()`.
4. Add it to `OPTIONAL_TABS` in `panes/tabSettings.ts`: its label, what it's for
   (Settings says this; the menu doesn't), and the agent tools that fill it.
5. A badge (unseen dot, count) is the tab's own business, beside the rule.

## Subagent tabs: a different family

An agent's subagents are pane tabs too (`agentChat/subagentPanel.tsx`), but they are
optional panels of the `sub:` kind, not under `coming.ts`: don't route them through it.
They keep the same spirit. Each one's tab places itself right after its agent's tab
(and the agent's earlier subagents, in start order) when it starts, without selecting
it or moving focus (`panes/owned.ts`; one the user moved stays put). A finished one's
× hides it (`closedTabs.ts`), nothing is deleted, and its card in the chat brings it
back; a running one, or one waiting on you, has no ×. A finished one nobody opened
also hides itself 5 minutes after it ends (`subagentIdle.ts`, applied by
`subagentAutoClose.ts`); shown in a pane, or arranged into a layout, it stays.
Settings → Tabs turns that off. They have no ⌘1–9 number and
aren't listed in the pane menu's Tabs; the next/previous-tab keys step through the
agent and its subagents.

## Don'ts

- No "Close" or "Hide" button inside a tab's content. The tab's × is the one way to
  close a tab.
- No per-domain `revealed` / `peeking` / `dismissed` state. That's `coming.ts`'s.
- No long text in the pane menu. What a tab is for lives in Settings → Tabs.
