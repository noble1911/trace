# Skills plan: skill sources from GitHub, installed into projects

Someone who isn't technical should be able to pick a GitHub repo of skills, see what's
in it in plain words, install what they want into their projects, and have it kept up
to date — without a terminal, and without trace knowing any repo in advance.

Nothing is hardcoded: a **skill source** is any GitHub repo the user picks from trace's
repo browser (`github/repo_list.rs`), the same one Clone uses.

## Two kinds of source, one page

| Kind | How it's recognised | What installs it | Update record |
|---|---|---|---|
| **Plugin marketplace** | `.claude-plugin/marketplace.json` at the root | Claude Code itself: `claude plugin … --json` | Claude Code's (versions, auto-update) |
| **Skill folders** | No marketplace file; one or more `…/<name>/SKILL.md` | trace copies the folder into `.claude/skills/<name>/` | `skills-lock.json` (the `npx skills` format) |

A marketplace repo (e.g. a team's `…-skills` repo with `delivery`, `support`, … plugins)
lists **plugins**, each a set of skills. A folder repo lists **skills** directly. The
page draws both as cards: a name, the description in its own words, the skills inside
(each `SKILL.md`'s `name` and `description` frontmatter), and a version where there is one.

### Why Claude Code does the plugin installs

It already has the install, version, scope and auto-update model, and it's the thing
that loads plugins. If trace copied plugin files itself it would drift from how Claude
Code reads them, and a skill would silently not load. So trace drives the CLI:

- `claude plugin list --available --json` — what each marketplace offers (`pluginId`,
  `name`, `description`, `marketplaceName`); `claude plugin list --json` — what's
  installed, with `scope` (`user` | `project` | `local`) and `projectPath`.
- `claude plugin install <name> --marketplace <owner/repo> --scope <s> --json -y`,
  run with the project as its working directory. A marketplace not added yet is added
  first.
- `claude plugin update`, `uninstall`, `marketplace update` — the same, with `--json`.

The CLI is found through `claude/discovery.rs` and spawned through `platform::process`,
like every agent. Its `--json` lines are parsed in one module, tested on recorded output.
Private repos: Claude Code fetches with git, which uses the user's `gh` login (set up as
part of installing trace). trace's own GitHub token is only used to *browse* sources.

## Where it goes, in plain words

**Install…** on a card opens a checklist: every repository in Settings → Repositories,
and *Everywhere, just for me*. Each project row picks one of two:

- **For everyone on this project** — Claude Code's `project` scope: it writes the
  project's `.claude/settings.json` (`enabledPlugins`, `extraKnownMarketplaces`), a file
  that's committed, so teammates get the same skills. For a skill folder: the folder in
  `.claude/skills/<name>/` plus its `skills-lock.json` entry, also committed.
- **Just me** — `local` scope: `.claude/settings.local.json`, not committed. A skill
  folder has no per-person form, so it offers only the two others.

*Everywhere, just for me* is `user` scope (`~/.claude/…`): every project, this person only.

**Already installed for you.** Before offering Install, trace reads what the project's
default branch has committed (`git show <default>:.claude/settings.json` and
`:skills-lock.json`). A plugin already enabled there, or a skill already in the lock,
shows **Installed for everyone on this project** and no Install for that project: it
comes with the repo, so installing again would only make a second, competing record.

**Worktrees.** Agents run in worktrees (`<repo>/.worktrees/<slug>`), each its own project
root to Claude Code. Committed files arrive with the branch. The uncommitted
`.claude/settings.local.json` doesn't, so worktree setup copies it from the main
checkout (beside the repo's own `copy_files`), else *Just me* would vanish in an agent.

**Sharing.** *For everyone* changes files in the main checkout; until they're committed
and merged, teammates and new worktrees don't have them. The project row then says
**Not shared yet** with **Share with the team**, which starts a session in that repo
with a prompt to commit those files on a branch and raise a PR. Agents raise their own
PRs; trace never commits for the user.

## Keeping up to date

- **Plugins:** a card shows **Update available · 0.9.2 → 0.9.4** when the marketplace's
  version is newer than an installed one, with **Update**. A *Keep up to date
  automatically* switch per source turns on Claude Code's marketplace auto-update.
  trace refreshes marketplaces (`marketplace update`) when the page opens, at most hourly.
- **Skill folders:** the source's folder is compared with the lock's entry (the folder's
  git tree SHA from the GitHub API; the lock's `computedHash` is the `npx skills` hash,
  checked against the same algorithm once it's confirmed). **Update** copies the new
  folder in and rewrites the entry. For *everyone*, that's a change to share, as above.

## Persistence and modules

- `skill-sources.json` (`helpers::persist`, `0600`): the sources the user added —
  `{ repo: "owner/name", kind: "marketplace" | "folders", addedAt, autoUpdate }`.
  Nothing else: what's installed is read from Claude Code and the projects each time,
  so trace never holds a stale copy of it.
- Backend `src-tauri/src/skills/`: `source.rs` (read a repo over the GitHub API: kind,
  plugins, skills, frontmatter), `cli.rs` (the `claude plugin` port + `--json`
  parsing), `project.rs` (committed state: settings and lock, read from git),
  `folders.rs` (copy a skill folder, write the lock), `store.rs`. Commands in
  `commands/skills.rs`, IPC in `src/ipc/skills.ts`.
- Frontend `src/domains/skills/`: the **Skills** tab on the Integrations page (beside
  MCP servers), the source cards, the install checklist, and a project's skills in
  Settings → Repositories.

## Stages

1. **Sources and browsing.** Add a source from the repo browser, read it over the API,
   show its plugins or skills. Read-only; nothing installs.
2. **Plugins: install, update, remove** through `claude plugin`, with scopes, the
   *already installed* check, auto-update, and copying `settings.local.json` into
   worktrees.
3. **Skill folders:** copy-in, `skills-lock.json`, updates by folder SHA.
4. **Share with the team:** *Not shared yet* and the session that raises the PR.

## Open questions

- `skills-lock.json`'s `computedHash` algorithm (to recognise an `npx skills` install as
  current). Until confirmed, trace records its own `folderSha` beside it and treats an
  entry without one as "installed, version unknown".
- Codex agents don't read Claude Code plugins; the page says skills are for Claude.
