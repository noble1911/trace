# Remote execution

Plan for running agents somewhere other than this machine: in a cloud sandbox (Vercel first), or on
another computer running trace, reached over Tailscale. Phase 1 and Vercel sessions, terminal and chat (Phase 2b), are built; the peer host is paused at its protocol (see [Phases](#phases)). This is
the roadmap's **Cloud VMs** item, widened to cover other traces.

## Goal

A session or ticket agent can be started on a remote host and used from trace as if it were local:
you see its screen, type into it, stop it. A session started on a remote host is visible from
**every** trace that can reach that host, not only the one that started it, and you can join it from
any of them.

**Out of scope for now:** the mobile apps (noted under [Later: mobile apps](#later-mobile-apps)
so nothing here closes them off), plain-LAN peers without Tailscale, and a headless trace server.

## Decisions

- **Two kinds of host, each behind the same port:** a *sandbox* from a cloud provider, and a *peer*
  (another trace). Either can be built first: after Phase 1 they don't depend on each other.
- **Cloud providers are abstracted too.** Vercel Sandbox is the first one, but the sandbox logic
  (checkout, tmux, discovery, credentials) is written once against a `SandboxProvider` port, so
  E2B, Daytona, Modal, Fly Machines, Codespaces or a plain SSH box can be added as adapters.
- **The host is the source of truth**, the same way a tracker is. trace keeps no local list of
  remote sessions: it asks each host. That's what makes a session visible from every trace.
- **Sessions are shared, like tmux.** Everyone attached sees the same screen and can type, and the
  last one to resize sets the size. On a sandbox this *is* tmux. A peer does the same by sending
  its one PTY to every viewer.
- **Claude credentials are a choice per host.** OAuth token is the default (`claude setup-token` →
  `CLAUDE_CODE_OAUTH_TOKEN`). An API key and an interactive `/login` inside the session are also
  offered. A peer uses its own machine's login, so the client sends none.
- **Peers use Tailscale only for now.** The server listens only on its tailnet address, never on
  `0.0.0.0`.

## Architecture: ports and adapters

Three ports, from what trace needs down to what a vendor provides:

```
AgentHost                      what trace needs: list, spawn, attach, capabilities
├── LocalHost                  today's portable-pty path, unchanged
├── PeerHost                   another trace over Tailscale (WebSocket protocol)
└── SandboxHost<P>             generic: checkout, tmux, labels, credentials
        └── P: SandboxProvider what a vendor gives: create, exec, PTY, list, snapshot
                ├── Vercel     first adapter
                └── E2B / Daytona / Modal / Fly / SSH …   later
ClaudeCredential               OAuth token | API key | interactive /login
```

This follows `issues::IssueProvider`, not `platform/ports.rs`. The platform ports pick one adapter
when the app is compiled. Hosts are picked at runtime, several are connected at once, and every
command says which one it means.

### `AgentHost`

```rust
trait AgentHost {
    fn list(&self) -> Result<Vec<RemoteSession>, HostError>;
    fn spawn(&self, launch: &AgentLaunch) -> Result<Box<dyn AgentSession>, HostError>;
    /// Join a session another trace (or this one, before a restart) started.
    fn attach(&self, id: &str, from_seq: u64) -> Result<Box<dyn AgentSession>, HostError>;
    fn capabilities(&self) -> Capabilities;
}

trait AgentSession: Send {
    fn write_input(&mut self, data: &[u8]) -> io::Result<()>;
    fn resize(&self, cols: u16, rows: u16) -> Result<(), String>;
    /// Ends the agent for everyone, not just this viewer.
    fn stop(&mut self);
    /// Leave it running and stop watching.
    fn detach(&mut self);
}
```

- `AppState.pty_sessions` changes from `HashMap<String, PtySession>` to holding
  `Box<dyn AgentSession>`. That's the only place the app is wired to the local PTY today.
- `commands::agent::spawn_in` picks a host instead of calling `spawn_agent_pty` directly.
  Every start path goes through it, so they all get remote hosts at once.
- Output comes back through the events the renderer already uses: `pty-output {workspaceId, data,
  seq}`, `agent-run-state` and `agent-turn`, so xterm, the output buffer and Fleet don't change.
- **`Capabilities`** says what a host can fill: hooks, transcript, Files/diff, Terminal, Tests,
  agent tools. The tabs rule (`panes/coming.ts`) greys out the rest. No `if remote` checks spread
  through the UI.
- `repo_catalog::Checkout` gets the variants it was tagged for: `Peer { peer, path }` and
  `Sandbox { provider, id }`.
- Remote sessions stay out of `running-agents.json`. They keep running when trace quits, and on
  launch trace finds them again with `list()` and offers to rejoin them.

### `SandboxProvider`

```rust
trait SandboxProvider {
    fn create(&self, spec: &SandboxSpec) -> Result<SandboxId, ProviderError>; // image, labels, timeout, env
    fn list(&self, label: &Label) -> Result<Vec<SandboxInfo>, ProviderError>;
    fn exec(&self, id: &SandboxId, cmd: &[String], env: &Env) -> Result<ExecOutput, ProviderError>;
    fn open_pty(&self, id: &SandboxId, cmd: &[String], size: PtySize) -> Result<PtyStream, ProviderError>;
    fn extend(&self, id: &SandboxId, by: Duration) -> Result<(), ProviderError>;
    fn snapshot(&self, id: &SandboxId) -> Result<SnapshotId, ProviderError>;
    fn stop(&self, id: &SandboxId) -> Result<(), ProviderError>;
    fn limits(&self) -> ProviderLimits; // max runtime, label count, snapshots or not
}
```

`SandboxHost<P>` does everything else, the same way for every provider:

1. **Create** from an image that already has `git`, `tmux` and `claude` (Vercel's default one
   does), or from a snapshot, so a start doesn't spend minutes installing.
2. **Check out** the repo: clone at a branch, logged in by the network policy (or, without one,
   with trace's GitHub token only in the clone's env), then run the repo's setup commands.
3. **Run the agent in tmux:** `tmux new-session -d -s trace-<ws> claude …`, with
   `window-size latest` so whoever typed last sets the size (by default tmux shrinks everyone to
   the smallest client).
4. **Attach** by opening a PTY that runs `tmux attach -t trace-<ws>`. A second trace attaching is
   the same call. That's the shared session.
5. **Label** the sandbox so `list()` finds it: `trace=session`, `trace.ws`, `trace.repo`,
   `trace.branch`, `trace.by`. Providers differ on labels (Vercel: 5 tags, filters on one at a
   time), so the adapter maps them, and a `~/.trace/session.json` manifest in the sandbox holds
   whatever doesn't fit.
6. **Keep it alive:** extend while someone is attached or a turn is running, up to the provider's
   limit, and say so in the UI before it runs out.
7. **On stop:** the work lasts as the pushed branch or PR, plus a snapshot so the session can be
   resumed later (`--resume` its conversation in a sandbox made from the snapshot).

### `ClaudeCredential`

| Choice | How it reaches the agent | Notes |
| --- | --- | --- |
| **OAuth token** (default) | The sandbox's network policy; a placeholder `CLAUDE_CODE_OAUTH_TOKEN` in env | From `claude setup-token`. Uses the subscription. |
| API key | The network policy (`x-api-key`); a placeholder `ANTHROPIC_API_KEY` in env | Billed per token. |
| `/login` in the session | Typed by the user in the shared tmux | Stays in that sandbox only, so it's gone with it unless snapshotted. |

- Stored Rust-side in a `0600` file like Jira's. It never crosses to the renderer and is never put
  in labels, args, logs or the manifest.
- **No secret enters the sandbox** (`sandbox/egress.rs`). Vercel's firewall runs outside the
  microVM and sets headers on matching HTTPS requests, overwriting what the code inside sent, so
  each start (made, resumed or joined) puts the logins in the sandbox's network policy: GitHub
  for `github.com` (git's Basic header) and `api.github.com`/`uploads.github.com` (Bearer), Claude
  for `api.anthropic.com` (`Authorization` or `x-api-key`), and a model provider's key for its
  endpoint's host. The agent's env holds placeholders, so `gh` and `claude` send a header for the
  firewall to replace. Vercel keeps the policy for later sessions and only ever reports header
  names back. Tried live on Hobby (`vercel_live_egress`): a private clone with no token, `gh`,
  `git push`, `claude -p`, and the policy kept across stop and resume, with no secret in
  `/proc/*/environ` or any config file. If the policy can't be set, the secrets go in the env as
  before and the session says so.
- The agent can still *use* those logins while it runs, as with any agent. What changes is that
  it can't read, print or carry them off, and neither can anyone else with access to the team.

## Host 1: a peer trace over Tailscale

- **Server mode** is a Settings toggle. It starts a WebSocket listener bound to this machine's
  Tailscale IP, found with `tailscale ip`, and nowhere else.
- **Pairing:** the server shows a pairing token, which the client stores `0600`. Every connection is
  checked with the existing `render_bridge::constant_time_eq`. Optionally the server also asks
  Tailscale's `whois` which tailnet user is connecting.
- **Finding peers:** `tailscale status --json` lists the machines, and trace probes each for its
  port. Paired ones show as hosts.
- **Protocol** (versioned, `peer/protocol.rs`): requests `hello{version}`, `list`, `spawn`,
  `attach{id, fromSeq}`, `input`, `resize`, `stop`, `detach`. The server streams back `output{seq,
  data}`, `runState` and `turn`.
- **Why it's the full feature set:** worktrees, hooks, agent tools, transcripts and setup all run on
  the server as they do today. Only the screen and keystrokes travel. Files/diff, Transcript and
  Tests can be added to the protocol later as more message types.
- **Sharing:** the server's one PTY goes to every viewer (its own UI and each client). Anyone can
  type, and the last resize wins. No tmux is needed, so a Windows peer works too.
- **Limit:** agent tools run in the server's renderer, so the server's trace window has to be open.
  A headless server is a later question.

## Host 2: Vercel Sandbox

What Vercel offers, read from its SDK, its CLI and its docs, then tried from Rust on a live
sandbox (spike 0.1, 2026-11-08, Hobby plan).

- **Connect:** an Integrations card (`domains/integrations/registry.ts`) for a Vercel token plus a
  team and project, saved in a `0600` file and checked with a cheap list call. REST is
  `https://api.vercel.com` with `Authorization: Bearer` and `?teamId=`.
- **Model:** a named, persistent *sandbox* runs *sessions*. Stopping one snapshots it, and a
  resume starts a new session from that snapshot. Create is `POST /v3/sandboxes` (`projectId`,
  `name`, `source`, `timeout`, `env`, `tags`, `persistent`).
- **The default image** (Ubuntu 26.04, user `ubuntu`, `HOME=/vercel`) already has `git`, `tmux`,
  `gh`, Node and Claude Code, so no custom image is needed. A sandbox is running ~0.3 s after
  the create call. The network is open by default, so GitHub and
  Anthropic are reachable.
- **Discovery:** `GET /v2/sandboxes?project=&tags=trace:session`, with the other tags filtered on
  our side (the API takes one tag filter). Stopped sandboxes are listed too. Any trace with the
  same token sees the same sessions.
- **PTY, a WebSocket:**
  1. `POST /v2/sandboxes/sessions/{id}/interactive` returns `{url, token}`.
  2. `GET <host>/health`, then connect to `url?token=…`. The URL carries the token, so it's never
     logged.
  3. Send a JSON text frame `{"type":"start","command":"tmux","args":[…],"env":["K=V"],"cwd",
     "cols","rows"}`.
  4. Keystrokes go up and output comes down as binary frames. A resize is
     `{"type":"resize","cols","rows"}`, and the end is `{"type":"exit","code"}`.

  Blocking `tungstenite` with rustls speaks it, on a `std::thread` like every other PTY pump.
  **Tried and working:** no `__interactive` flag is needed (every session gets an
  `interactivePort`). Typing and resizing work. The tmux session survives its socket closing.
  Two sockets on one tmux session at once both see what either types. When the process ends,
  the server sends `{"type":"exit"}` (no `code` for 0) and then drops the connection without a
  TLS close, which the client must treat as a normal end after an exit frame. tmux repaints the
  screen on attach, so a sandbox needs no `fromSeq` replay.
  `/interactive` isn't in Vercel's public API spec, so it could change. tmux driven through
  `POST …/cmd` (`send-keys`, `capture-pane`) is the fallback behind the same `PtyStream`.
- **Keep-alive:** `POST /v2/sandboxes/sessions/{id}/extend-timeout`, a little before each expiry
  while someone is attached, as Vercel's CLI does. A session lasts at most 45 min on Hobby and
  24 h on Pro/Enterprise.
- **Snapshots:** `POST /v3/sandboxes/sessions/{id}/snapshot`, which stops the session. They're
  kept 30 days after last use (v3) or 7 days (v4) unless an expiry is set, and only work in the
  region they were made in.
- **Chat, as well as the terminal** (`execution/sandbox/chat.rs`): headless `claude` in
  stream-json runs as a background command. Its stdin is `POST …/cmd/{id}/stdin` (one call
  per message, ~0.2 s round trip); its stdout and stderr come from `GET …/cmd/{id}/logs`, which
  replays from the start. The chat adapter talks to an `agent_session::process::ChatProcess`,
  so it can't tell this from a local child. Its turns and approval prompts come in-band, so the
  chat is exact on Vercel where the terminal guesses from a quiet screen. The log response
  only starts with the first output, and the blocking HTTP client's default 30 s timeout must
  be off for it.
- **Both transports work the same way:** **Disconnect** (and quitting trace) leaves Claude
  working in the sandbox; **Start** rejoins it, a chat skipping the output it already turned
  into rows (`chat_offsets`); **Stop & save** ends Claude and stops the sandbox, which Vercel
  snapshots; Start resumes it (`--continue` / `--resume <id>`). Each transport ends the other's
  Claude first, so one conversation never has two.
- **Snapshots:** each is a copy of the whole disk (~1 GB) and Hobby's snapshot storage is
  small. Vercel keeps a deleted sandbox's snapshot, which once filled the allowance and blocked
  every sandbox, so `remove` deletes it too, and sandboxes keep only their latest snapshot
  (`keepLastSnapshots: {count: 1}`) for 7 days.
- **GitHub account per repo:** trace can hold several GitHub accounts (`github::accounts`);
  `github::pick` chooses one for a sandbox: Settings → Repositories, the SSH alias
  (`github.com-<login>`), the owner, else whichever can push.
- **The repo's setup runs in the sandbox** (`sandbox/setup.rs`): its commands, after the clone,
  in a login shell with the agent's env (so a private package install is logged in through the
  network). Files the setup copies from the main checkout (a `.env`) stay on this machine, and
  the session says so.
- **The sandbox's event log** (`sandbox/helpers.rs`, `sandbox/events.rs`): every start writes
  two helpers into `~/.local/bin`, first on the image's PATH. `trace-hook` appends each hook
  event to `~/.trace/events.log` as `<seq> <event> <base64 input>`, the message
  `claude::hooks` takes from the render bridge locally; a terminal agent's `--settings` points
  its hooks there. A `gh` shim logs the URL `gh pr create` prints as a `pr` event. While a
  session is attached trace tails the log from the last `seq` it read
  (`sandbox-event-offsets.json`): of what it missed it records every PR and passes on only the
  newest turn event (where the agent stands now), then each event as it comes. PRs reported
  this way (`sandbox-prs.json`) come before the branch's in the Pull request tab, so one from a
  branch the agent named is found.
- **Files** (`sandbox/files.rs`, `commands/sandbox_files.rs`): the change list, a file's diff,
  its text and the file list are read with git in the running sandbox, one command each, in
  the shapes the local readers give. A stopped sandbox has none to show.
- **trace's tools in a sandbox chat** (`agent_session::ToolsHost`): the chat's Claude is told,
  with an `initialize` control request as the Agent SDK sends, that `trace` is an SDK MCP
  server, and then sends each MCP message as an `mcp_message` control request. trace answers it
  with `agent_tools::rpc` and the renderer's tools, as the loopback endpoint does, off the
  agent's thread (a tool can wait on a confirm card), and writes the reply as a
  `control_response`. No port, no token, nothing on a command line. Tried with a real `claude`
  here (`sdk_mcp_smoke`) and in a sandbox (`vercel_live_tools`, Claude Code 2.1.317).
- **Previews** (`sandbox/preview.rs`, `SandboxPreviews`): each preview port has a public URL
  for as long as the sandbox runs, so Details says they're public.
- **What a Vercel session can't do:**
  - A terminal agent doesn't get trace's tools (only the chat has a control channel).
  - A tool call made while no trace is attached waits until one is, and one that was pending
    when the chat was disconnected isn't answered on rejoin.
  - No Transcript, Tests or Terminal tabs, and no extra agents (`Capabilities`).
  - A permission prompt raised just before a chat is disconnected may not show on rejoin.
  - The chat needs a Claude login saved for sandboxes: with none, `/login` has nowhere to
    go, so a session made without one stays a terminal ("Open as chat" says why).
- **Where it's shown:** the session's header and list row say "Vercel Sandbox · owner/name";
  its Details (`SandboxSection`, `sandbox_state`) say whether the sandbox is running
  (attached or unattended), saved as a snapshot, or expired, with the time Vercel gives it
  (`session.startedAt + timeout`; the snapshot from `statusUpdatedAt + snapshotExpiration`).
  The Vercel dialog has a checklist: token, Claude login, a GitHub account that can push.

## Later: mobile apps

The roadmap's iPhone and Android apps aren't planned yet, but this work shouldn't close them off:

- **The peer protocol is the mobile API.** Keep it versioned and documented, and free of anything
  specific to Tauri or the renderer. A phone with the Tailscale app reaches a peer the same way a
  desktop does.
- **Keep it cheap on a phone:** chunked output with `fromSeq` replay (a phone drops connections
  all the time), and `turn` / needs-input events, so a phone can mostly show what needs you
  without rendering a full terminal.
- **Pairing should work with a QR code later.** The token format shouldn't stop that.
- **Vercel is the phone's first host, not a peer.** A desktop that's on doesn't need the cloud,
  so Vercel matters most where there's no desktop: on a phone. Discovery is already by tag and
  the terminal is Vercel's own WebSocket, so a phone can list, start and join sandbox sessions
  without any trace running. What it needs is the Vercel and Claude tokens on the phone (in its
  keychain), or a small relay that holds them.
- A **headless trace server** (agent tools run outside a renderer) makes a phone's host always
  available. It's worth planning when mobile is.

## Phases

### Phase 0: Spikes

- [x] 0.1 Open a Vercel sandbox PTY from Rust, then type and resize. Done on a live sandbox with
      a throwaway program (results under Host 2).
- [~] 0.2 Two clients on one tmux session with `window-size latest`. Both see each other's typing
      on a live sandbox. How it feels in xterm is still to try.
- [ ] 0.3 Bind a listener to the Tailscale IP on macOS, Linux and Windows, and work out what to do
      when Tailscale goes down or the IP changes.

### Phase 1: The port, with no behaviour change

- [x] `execution/` module with `AgentHost`, `AgentSession`, `Capabilities` and `LocalHost`
      wrapping `spawn_agent_pty`.
- [x] `pty_sessions` holds `Box<dyn AgentSession>`, and `spawn_in` resolves a host
      (`Host::for_workspace`, always this machine for now).
- [x] Every existing test passes. `start_terminal` moved to `commands/terminal.rs` to keep
      `commands/agent.rs` under the cap.
- [ ] Checked by hand in the app: start, type, resize, stop and restart an agent.

### Phase 2a: Peer host

*Paused (2026-11-08): Vercel first. Tailscale's Personal plan is free when this resumes.*

- [x] Protocol (`execution/peer/protocol.rs`): versioned messages, unknown requests answered with
      an error.
- [x] Pairing (`execution/peer/pairing.rs`): the server's token, `trace-pair:` codes, paired
      peers in `peers.json`, constant-time check.
- [ ] Server mode: a WebSocket listener on the Tailscale IP, sending `pty-output`,
      `agent-run-state` and `agent-turn` to attached clients.
- [ ] Client: a `PeerHost` and a remote `AgentSession`.
- [x] Peers in Settings (discovery, pairing, server switch: Integrations → Tailscale).
- [ ] A "Run on" choice when starting a session or agent.
- [ ] A host badge on Sessions and Fleet. Rejoin remote sessions on launch.

### Phase 2b: Sandbox host + Vercel

- [x] `SandboxProvider` port, `SandboxHost<P>`, the Vercel adapter and its Integrations card.
      A session's sandbox is `trace-<session id>`, persistent, tagged `trace=session`,
      `trace.ws`, `trace.repo`, `trace.title`. Starting returns a terminal at once; the
      sandbox, clone and `claude` start on the session's thread, printing each step into it.
- [x] `ClaudeCredential` settings (OAuth by default, API key, or `/login` in the session).
- [x] "Run on: Vercel" in New Session, a Vercel badge, and an "On Vercel" list with Join.
- [x] Keep-alive (extend every 10 min while attached). Vercel's default image needs no setup.
- [x] A live test (`execution/vercel/live_tests.rs`, ignored by default) runs connect, start,
      attach, discovery and rejoin against a real account.
- [x] Tried by hand in the app: a terminal session raised a PR on `noble1911/trace`.
- [x] Persistent sandboxes: Stop & save snapshots, Start resumes (`--continue`).
- [x] The chat on Vercel, Disconnect / rejoin for both transports, clearer buttons
      (Disconnect, Stop & save, Start on Vercel) and the session's own status lines.
- [x] Live tests for both transports: start, rejoin, stop & save, resume
      (`vercel_live` in `execution/vercel/live_tests.rs`, with a cleanup guard).
- [ ] Scheduled prompts on Vercel (see below), and the phone (Phase 4).

### Phase 3: Richer remote sessions (on a par with Conductor)

Conductor's cloud workspaces run on Vercel Sandbox too (its runner only accepts `vercel`), so
what it does on top of the platform is a fair bar. Read from its runner (v22, 2026-11-04):

- **No secret in the VM.** `git`/`gh`/`git-askpass` wrappers fetch a short-lived GitHub token
  per call from a `0600` Unix-socket broker and report a refused one by its hash; shells have
  the Anthropic/OpenAI keys stripped.
- **A checkpoint at each turn's start and end**: the whole working tree, untracked files
  included, as a private ref through a temporary `GIT_INDEX_FILE`, never moving HEAD or touching
  files. The turn's diff goes in the event stream; rewind forks the conversation
  (`--resume-session-at`) and restores the checkpoint.
- **Prepared VMs:** an install script baked into a snapshot, a setup script per repo, pinned
  `claude`/`codex`/`gh` versions, and a fingerprint that decides when to rebuild.
- **A durable outbox** of numbered events that survives the app being closed, the `gh` wrapper
  linking a PR by the URL `gh pr create` printed, its own tools served in-process over the
  agent's control channel, idle sleep after 5 min, port forwarding and previews, and moving a
  cloud workspace's work to the Mac ("Spotlight").

trace gets the same outcomes **without a backend**: the sandbox's network policy holds the
tokens, files under `~/.trace/` in the sandbox are the outbox (read from an offset, like
`chat_offsets`), and snapshots are the build cache. Each step ends by turning on a flag in
`sandbox::host::CAPABILITIES`.

- [x] **A. Secrets out of the VM.** Vercel's firewall injects headers outside the microVM
      (`POST /v2/sandboxes/sessions/{id}/network-policy`, a `transform` per domain): GitHub
      (`github.com` Basic for git, `api.github.com` Bearer for `gh`), Anthropic (`Authorization`
      or `x-api-key`) and each model provider. The env holds only placeholders. Applied on every
      create and resume; without injection on the plan, the old env path stays and the Vercel
      checklist says so. Optional per-repo deny-all allowlist.
- [~] **B. Checkpoints and Files.** *Files on Vercel: done.* Next, `trace-checkpoint` (ours,
      same technique) under `refs/trace-checkpoints/`, at each turn's start and end, locally and
      in a sandbox; a `PreToolUse` wait for the start one; "Changed in this turn" in the chat;
      then undo a turn.
- [~] **C. Prepared sandboxes.** *The repo's setup in the sandbox: done.* Next, a base snapshot
      per repo (clone, setup, pinned Claude, trace's helpers, `~/.trace/manifest.json`), rebuilt
      in the background when its fingerprint changes; a failed build keeps the old one.
- [x] **D. The event log.** `~/.trace/events.log` with a monotonic `seq`: Claude's hooks and the
      PRs `gh pr create` opens. trace tails it from its last `seq` on attach and passes turns to
      `claude::hooks`, so a terminal on Vercel gets real turns, and what happened while trace
      was closed is caught up on. Tried live: a real Claude's `Stop` hook arrives, a backlog
      gives only its newest turn and every PR, a rejoin replays nothing.
- [x] **E. Tools in the sandbox.** trace's tools for a chat, as an SDK MCP server over its
      control channel (`mcp_message`), the way Conductor serves its own; and the team's own MCP
      servers, logged in to by trace and their tokens added by the network (below).
- [x] **F. Lifetime unattended.** `trace-keepalive` runs in the sandbox (`sandbox/helpers/`),
      started on every start, one at a time. Every minute: *working* is a terminal attached,
      trace's heartbeat (the log follower touches `~/.trace/attached` every 2 min), or Claude
      mid-turn or with background tasks (from the event log; chats get the hooks too). While
      working it extends the session every 10 min; idle for a while it stops it (Vercel saves
      it, Start resumes); a run has a cap. Both are settings (Integrations → Vercel,
      `sandbox/lifetime.rs`): 10 minutes idle and 6 hours by default. Its calls carry no token: the network adds the
      Vercel token only for `POST` to this session's own `extend-timeout` and `stop`
      (`SandboxProvider::self_service`). Tried live: its extend gets 200, any other Vercel call
      403; it extends while watched and stops once idle. On Hobby the extends fail past 45
      minutes (Vercel's ceiling), so it matters on Pro, where a session runs up to 24 h.
      Before this, a chat never extended its sandbox at all.
- [x] **G. Previews.** Sandboxes are made with ports 3000, 5173 and 8080 (an older one gets
      them on its next start); each has a public `https://<sub>.vercel.run` URL, listed in
      Details with a button to open it in the Browser tab. `localhost:<port>` in a sandbox
      session's Browser tab, from the agent's `open_browser` or the address bar, opens the
      port's preview (`sandbox/preview.rs`). Tried live: a server bound to `0.0.0.0` and one
      bound only to `127.0.0.1` both answer at their preview, and a port added to a running
      sandbox gets a route.
- [ ] **H. Continue locally / send to cloud.** Checkpoint, patch or pushed ref plus the
      conversation JSONL, then `--resume` on the other side.
- [ ] **I. Breadth.** Codex, Transcript from the sandbox's JSONL, Terminal as a second tmux
      window, Tests through `exec`, attachments into `.context/`.
- [ ] Peer: Files/diff, Transcript and Tests over the protocol.
- [ ] A second sandbox provider, to prove the port.

### MCP servers for trace's agents (`mcp_auth/`, Integrations → MCP servers)

Integrations has two tabs: the services trace works with, and **MCP servers**: a card per
server, from a curated list of popular ones (`catalog.rs`, each checked live: they log in with
self-registering OAuth, or are open, or take a key), the HTTP ones in your Claude config, and
any you add by URL ("Add your own…": OAuth if the server asks, else open, or a pasted key in a
header). Each connected server has two switches: **this computer** (on by default except for
servers your Claude config already gives local agents) and **sandboxes** (on by default).

- **This computer:** agents get each server in their `--mcp-config` beside trace's own tools,
  at `http://127.0.0.1:<port>/mcp-proxy/<name>` on the same loopback endpoint and token
  (`proxy.rs`). The proxy drops trace's token, adds the server's login, fresh, and streams the
  answer back; an upstream 401 becomes "connect it again in trace" rather than an OAuth dance
  the agent can't finish. Tried live: a server's key goes up and trace's token doesn't, path,
  query and the MCP session header are kept, and Context7 answers `initialize` through it.
- **Sandboxes:** as below.

What the team uses (Sentry, Metabase prod and stage, Atlassian, Pylon, hq-tools prod and stage,
Brandfetch) is all **HTTP with OAuth**: no static headers in anyone's config, the tokens in each
person's Claude Code keychain. A sandbox's Claude doesn't get claude.ai connectors with a
`setup-token` login (tried: `claude mcp list` is empty), so trace brings them. Conductor does it
with a backend that holds each OAuth token, and a proxy URL per server with a Conductor bearer
on Claude's command line. trace, without a backend:

1. **Which servers** (`servers.rs`): the HTTP ones in `~/.claude.json` (user and project
   scopes) and the repos' `.mcp.json`, names and URLs only. stdio servers stay local.
2. **Connect once per person** (Integrations → MCP servers, `flow.rs`, `oauth.rs`): trace is
   its own OAuth client. Resource and server metadata (RFC 9728, 8414), dynamic registration
   where the server offers it (RFC 7591), else a client trace was registered as once
   (`flow::KNOWN_CLIENTS`, or a client ID pasted in the dialog), PKCE (S256) in the browser,
   the resource named (RFC 8707), and the browser back at the fixed
   `http://127.0.0.1:47321/callback`. Tokens in a `0600` file (`store.rs`, `mcp-logins.json`),
   never Claude Code's own (refreshing those could rotate them out from under the local CLI).
   Discovery tried live against all eight: six register themselves; hq-tools prod and stage
   need trace registered with each, once; Brandfetch gives no refresh token.
3. **In a sandbox** (`for_sandbox`, `sandbox/ready.rs`): Claude gets `--mcp-config` with the
   servers by URL alone, and the network policy adds each token for its host and path
   (`startsWith`). Terminal and chat alike. Tried live: a header reaches a server's path and
   below and nothing else on its host, a server given by URL alone works through the
   sandbox's network, and an injected token reaches the server (Context7 rejected a made-up
   one).
4. **Refresh** (`sandbox/watch.rs`): while trace is open, every 5 minutes, tokens within 10
   minutes of expiring are refreshed and the policy sent again if it changed. With trace
   closed, an MCP login lasts as long as its last token (often an hour); a server whose login
   expired is left out of the next start, which says so.

**Not copied:** a backend and its multi-user grants, the Agent SDK running in the VM (trace
drives stream-json from the desktop, one implementation for both hosts), VNC/SSH, cgroup
watchdogs, other harnesses.

### Later: scheduled prompts on Vercel

Only worth it when the laptop is off. While trace is open, its runner already fires prompts
locally, so a sandbox adds cost and nothing else. With the laptop off, something in the cloud
has to fire them:

- **A Vercel Cron Job** calling a small function in the `trace-sessions` project, which does
  what `SandboxHost::prepare` does: create a sandbox, clone, and start `claude` in tmux with the
  prompt. Check the Hobby plan's cron limits (likely once a day) before relying on it.
- **Finishing a run** is the hard part. Locally, a run ends when Claude Code's hooks report a
  turn with nothing pending (`schedule/completion.rs`). A sandbox would need the `Stop` hook to
  write its event somewhere the driver can read, then save the transcript and stop the sandbox.
- **Prompts would live in the cloud**, since the driver can't read `schedules.json` on a
  laptop that's off. That's a sync question, best answered together with the mobile app.

### Phase 4: Mobile

A plan of its own, built on the peer protocol.

## Still to verify

- Vercel: how long a PTY socket's token lasts (trace asks for a fresh one per attach anyway).
- Vercel: whether tags still need a "Sandbox tags" permission. They were announced as beta, and
  the current docs don't say.
- Whether `CLAUDE_CODE_OAUTH_TOKEN` from `setup-token` covers everything a session needs (Remote
  Control, `/login` state), and how long it lasts.

## Where it lives

```
src-tauri/src/execution/
  mod.rs          AgentHost, AgentSession, Capabilities, Host enum
  local.rs        LocalHost (wraps claude/pty.rs)
  credential.rs   ClaudeCredential (0600)
  sandbox/        SandboxProvider port, SandboxHost<P>: checkout, tmux, labels, keep-alive
  vercel/         auth, client, provider (the SandboxProvider adapter)
  peer/           protocol, server, client, pairing, discovery (Tailscale)
src-tauri/src/commands/execution.rs
src/ipc/execution.ts
src/domains/execution/   host picker, peers, remote-session list
```

Every file stays under the 250-line target. `claude/pty.rs` is at 349 lines already, so
`LocalHost` wraps it rather than adding to it.
