# Research: Conductor / damon-ade / Herdr — inspiration audit and VS Code feasibility

Date: 2026-07-07
Author: researcher agent
Feeds: MVP scoping decision for the `intelligents` VS Code extension (agentic CRM /
multi-agent workspace manager for Claude Code + Copilot).

Status: web sources fetched 2026-07-07; product UIs verified via docs/marketing
pages only (no hands-on install of Conductor/ADE — both are macOS-only and this
dev machine is Windows). Local `~/.claude` structure verified directly on this
machine (`claude --version` → `2.1.202`).

---

## 1. Conductor (conductor.build, by Melty Labs)

**Sources:** [conductor.build](https://www.conductor.build/),
[docs.conductor.build → conductor.build/docs](https://www.conductor.build/docs/),
[HN launch thread](https://news.ycombinator.com/item?id=44594584).

**Problem solved:** running one coding agent at a time serializes a developer's
throughput. Conductor turns "one agent, one terminal" into "direct five agents
in parallel" by giving each task a fully isolated environment so agents never
step on each other.

**Core UX model:**

- **Workspace = unit of work.** "New Workspace" → name it (e.g. `add-search-api`)
  → Conductor creates a git branch and a **git worktree** automatically, copies
  only git-tracked files (so `node_modules`/`.env` aren't duplicated per
  workspace), and opens a terminal in it.
- **Dashboard** gives at-a-glance status across all open workspaces (which
  agent is running, idle, or needs input).
- **Runtime-agnostic**: supports Claude Code, Codex, and Cursor agents inside
  the same workspace model.
- **Review lifecycle is a first-class flow**, not an afterthought: diff viewer
  → open a PR → merge → **archive the workspace** (cleans up the worktree).
  This "archive" step is notable — it's the missing half of most worktree
  tooling, which creates worktrees easily but leaves cleanup manual.
- Free, macOS-only, BYO Claude/Codex subscription. No public keyboard-shortcut
  or notification-system detail surfaced in docs (not fully documented
  publicly — flagged unverified beyond what's above).

**Features worth adapting to VS Code:**

1. Workspace-per-task = worktree-per-task, created/named from one command,
   with auto branch naming.
2. Copy-only-tracked-files worktree creation (avoids `node_modules`/`.env`
   duplication cost) — this is really just `git worktree add`, which does this
   natively already; the useful idea is Conductor doesn't reinvent it.
3. Built-in "archive" action that removes the worktree and branch once merged
   — VS Code should offer this as an explicit command, not leave it to the user.
4. A single dashboard view surfacing all active workspaces' state — maps
   directly onto a VS Code **TreeView** in the sidebar.
5. Diff review as part of the same UI the agent ran in, not a separate tool —
   maps to VS Code's built-in SCM diff view, which the extension can invoke
   per-worktree rather than building a custom diff renderer.

---

## 2. damon-ade (github.com/per-simmons/damon-ade)

**Sources:** [repo README](https://raw.githubusercontent.com/per-simmons/damon-ade/main/README.md),
[docs/memory.md](https://raw.githubusercontent.com/per-simmons/damon-ade/main/docs/memory.md),
GitHub contents API (`apps/`, `docs/`, root dirs).

**What it is:** "ADE" — a local-first, single-user **macOS desktop app**
(Electron; Bun + Turbo monorepo, TypeScript 93.7%, Elastic License 2.0, forked
from a Superset-derived base) where you build a **roster of persistent coding
agents** and work alongside them in the terminal, instead of throwaway chat
sessions.

**Problem solved:** context loss between sessions. Each agent is a durable
identity (name, photo, its own git repo/worktree, runtime CLI, long-lived
memory) that you return to "tomorrow" and it remembers what it learned.

**Core UX model — organizational hierarchy:**

- **Teams** (top level, square photo) → **Agents** (circular photo, distinct
  identity) → **Sessions** (terminal tabs, one per agent, each a real terminal
  running the agent's CLI inside _that agent's own git worktree_).
- **Model bar** under session tabs: switch an agent's session to a different
  model/runtime (Claude Code, Codex, OpenCode, or open models via one
  OpenRouter key) without losing context — because context lives in memory
  files, not the runtime.
- **Agent Files panel** (right side): shows the agent's memory directory
  growing live as it works — Memory / Skills / Worktree sections.
- Sessions are literal terminals, not a custom chat UI — "making agents true
  CLI partners," directly validating the `agent-runtime-interop` skill's
  guidance to launch via `window.createTerminal` and not scrape output.

**Memory architecture (the most reusable idea here):**

```
<agent-home>/
├── worktree/            # git worktree; CLI's working directory
│   ├── CLAUDE.md        # generated bridge file, git-excluded
│   └── .claude/         # generated settings + reflection hook
├── memory/              # CANONICAL, lives OUTSIDE the worktree, never committed
│   ├── AGENT.md         # identity/persona, seeded once
│   ├── USER.md          # profile of the human (~1,375 char budget)
│   ├── MEMORY.md        # agent's own notes + index of topic files (~2,200 char budget)
│   ├── .writeback-protocol.md   # rules for how the agent maintains memory
│   └── memories/<topic>.md      # granular overflow files
└── skills/<name>/SKILL.md       # reusable procedures, name+description in context, body on demand
```

- Memory is a **sibling of the worktree**, not inside it — survives branch
  switches and worktree deletion, never risks being committed.
- Runtime-agnostic canonical files + generated thin per-runtime "bridge" files
  (`CLAUDE.md`, `opencode.json`) — switching an agent's runtime never loses
  memory, because the bridge is regenerated, not hand-maintained.
- Budgets are advisory, not hard-enforced — the agent is instructed to
  consolidate. **This is structurally identical to this repo's own
  `.harness/memories/*.md` + `team-memories/team.md` budget system** already
  in place (2,200 char personal / 4,000 char team) — strong validation that
  the harness's existing memory design is the right shape to extend, not
  reinvent.
- **Reflection loop**: a session-end hook prompts the agent to review the
  conversation and write back to memory/skills before the session ends —
  same shape as this repo's "memory-review step" run after every completed
  change.

**Features worth adapting to VS Code:**

1. Team → Agent → Session hierarchy is a clean model for a VS Code **TreeView**
   (`vscode.TreeDataProvider` with 3 levels: team node → agent node → session
   node), directly reusable as the CRM's primary navigation.
2. Memory-outside-worktree pattern is exactly what `.harness/memories/` +
   `.harness/team-memories/` already do at the repo level — the extension's
   job is to _surface_ this (read/render it in a webview panel), not
   reinvent a new memory store.
3. Model bar / runtime switching by editing `model:` frontmatter — matches
   `agent-runtime-interop` skill guidance verbatim; low-effort to implement
   (edit YAML frontmatter of the agent `.md` file, no custom protocol needed).
4. "Agent Files" panel showing memory growing live — a VS Code **webview
   panel** watching the memory file(s) with `vscode.workspace.createFileSystemWatcher`
   and re-rendering on change is a direct, low-risk port of this idea.
5. Session-end reflection hook — Claude Code's own hook system (`Stop` /
   `SubagentStop` hooks per Claude Code docs) can trigger this without the
   extension needing to inject anything into the agent loop itself.

---

## 3. Herdr (herdr.dev)

**Sources:** [herdr.dev](https://herdr.dev/), [herdr.dev/compare](https://herdr.dev/compare/),
secondary coverage (CoddyKit, AX Brief, PyShine) — **treat secondary-source
claims (star counts, "9,200 stars") as unverified marketing/aggregator copy,
not confirmed from the primary site.**

**What it is:** a **terminal-native agent multiplexer**, written in Rust,
positioned as "tmux but agent-aware." Not a VS Code or GUI product — it's a
CLI/terminal tool. Tagline: "Run all your coding agents from one terminal, on
any box, even over ssh."

**Problem solved:** fragmentation of agent management across desktop apps, web
dashboards, and scattered terminal windows/tmux panes when running many CLI
coding agents at once, especially across local + remote/SSH machines.

**Core UX model:**

- Real terminal panes/tabs (mouse-first), not a custom chat UI — preserves the
  user's existing shell/keybindings.
- **Session persistence**: agents keep running when you detach; reattach from
  any device (including SSH from mobile).
- **Agent state detection**: each pane is classified into `working` /
  `blocked` / `done` (marketing copy also mentions `idle`), surfaced at a
  glance across the "herd" — this is the single most relevant feature for an
  agentic CRM: **automatic session-state inference without the user manually
  tagging anything.** Exact detection mechanism not documented publicly
  (unverified — likely PTY output/prompt-pattern heuristics per-tool, not a
  disclosed API).
- **Programmatic control**: CLI + JSON socket API — agents can script Herdr
  itself (spawn a helper agent in a new pane, monitor it, read its output) —
  enabling agent-to-agent orchestration without a human in the loop.
- Plugin marketplace for notifications/layouts/link handlers.
- No Electron, no account, no telemetry — single compiled binary, install via
  shell script or Homebrew (macOS/Linux; Windows in beta).
- Supports 14+ agent CLIs (Claude Code, Codex, Pi, Amp, Droid, Hermes,
  OpenCode, Grok, etc.) via "direct integrations."

**Features worth adapting to VS Code:**

1. **Working/blocked/done state classification** is the killer feature to
   port. In VS Code terms: watch each Claude Code terminal via the **Shell
   Integration API** (`window.onDidStartTerminalShellExecution` /
   `onDidEndTerminalShellExecution`, `terminal.shellIntegration`) to infer
   "command running" vs "idle at prompt," combined with reading the session's
   `~/.claude/projects/<proj>/<session>.jsonl` tail to detect the last event
   type (assistant message vs. tool call vs. permission-request) for a richer
   "blocked" (waiting on permission) vs. "working" (mid-tool-call) vs. "done"
   (last event was a final assistant turn) signal. This is strictly better
   than Herdr's approach can be, since Claude Code's JSONL transcript is a
   structured, parseable signal Herdr doesn't have for a generic multiplexer.
2. Persistent, detachable sessions — VS Code's own integrated terminals
   already persist across the window session; less relevant to port directly
   (VS Code isn't meant to be detached-from like a remote tmux), but the
   underlying idea — "don't lose the session if the UI closes" — argues for
   the extension keying agent state off the **Claude Code JSONL session file**
   on disk (durable) rather than any in-memory extension state (ephemeral,
   lost on VS Code reload).
3. JSON socket / programmatic API for orchestration is out of scope for an
   MVP but is the natural v2 direction if agents should be able to spawn
   sub-agents through the extension rather than only through Claude Code's own
   subagent mechanism.
4. Not macOS-locked (Windows beta, Linux) — validates that a terminal/session
   monitoring approach is cross-platform-feasible, which matters since this
   extension targets Windows-first (dev machine is Windows 11) unlike
   Conductor and ADE which are Mac-only.

---

## 4. Realizing the core loop in VS Code — API surface and constraints

**Spawning/managing Claude Code sessions.** Per the `agent-runtime-interop`
skill and confirmed by `agent-runtime-interop`'s own guidance: use
`vscode.window.createTerminal({ name, cwd })` and run `claude` in it, one
terminal per session tab (mirrors ADE's "session = terminal tab" model).
**Do not scrape terminal output** as the source of truth for agent state —
treat it as opaque. This is a hard constraint: there is no public Claude Code
"Agent SDK" hook wired into the VS Code terminal API to get structured events
out of a terminal-hosted session; the terminal is for the human to watch/type
into, and reasoning about _state_ must come from disk, not the PTY.

**Monitoring agent state from `~/.claude` — verified locally
(`claude --version` → `2.1.202`, Windows, 2026-07-07):**

- `~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl` — one file per
  session, newline-delimited JSON. Confirmed record shapes seen: `{"type":"mode",...}`,
  `{"type":"permission-mode",...}`, `{"type":"attachment",...}` (e.g.
  `goal_status` sentinel attachments), `{"type":"user", "message":{...}, "uuid", "parentUuid", "timestamp", "cwd", "sessionId", "version", "gitBranch"}`.
  Each record carries `sessionId`, `timestamp`, `cwd`, and a `parentUuid` chain
  — enough to reconstruct turn order and detect the _last_ event's type
  (tailing the file cheaply tells you if the last thing that happened was a
  user message, an assistant message, a tool call, or a permission gate).
- `~/.claude/sessions/<pid>.json` — separate from `projects/`; not
  content-inspected in this pass (flagged for follow-up if session metadata
  beyond the transcript is needed, e.g. a lighter-weight "is this session
  alive" signal keyed by PID).
- `~/.claude/tasks/<uuid>/` — present per-session; not content-inspected this
  pass (likely subagent/task-tool records; follow-up needed before relying on
  it).
- `~/.claude/history.jsonl`, `~/.claude/shell-snapshots/`, `~/.claude/backups/`,
  `~/.claude/plans/` also exist locally — none inspected this pass.
- **Caveat carried over from the skill file and reinforced by this pass:**
  these are undocumented, internal formats that "drift with tool releases."
  Everything above is empirical (observed on one machine, one version) not
  a published spec. Any code that parses these files must be defensive
  (unknown `type` values, missing fields) and should be treated as a
  best-effort enrichment layer, not the sole source of truth for whether a
  session is "done" — pair it with the Shell Integration API's command
  start/end events for a more reliable "process is currently running a
  command" signal.

**Git worktree management.** No native `vscode.git` worktree API — the built-in
Git extension's API (`vscode.git` extension export) exposes repository/branch
state but not worktree creation. The extension would shell out to
`git worktree add <path> -b <branch>` / `git worktree remove` via VS Code's
`vscode.workspace.fs` + child process (or the `Bash`/`PowerShell`-equivalent
inside the extension host, i.e. Node's `child_process`), then use
`vscode.window.createTerminal({ cwd: worktreePath })` to run the agent inside
it, and optionally `vscode.workspace.updateWorkspaceFolders` to add the
worktree as a workspace folder for SCM/diff integration, or rely on the SCM
API pointed at that path without adding it as a folder.

**Shell Integration API** (confirmed via VS Code docs, current as of
2026-07): supports bash/fish/pwsh/zsh on macOS/Linux and Git Bash/pwsh on
Windows. Gives command-start/end detection, exit codes, and CWD tracking
without regex/polling — but only at "rich" quality when the shell's
integration script is actually injected (auto by default; can silently
degrade to "basic" or "none" for unsupported `$PROMPT_COMMAND` setups, shell
plugins that unset `$VSCODE_SHELL_INTEGRATION`, or old shells). **This means
the "is a command running right now" signal is not 100% guaranteed** and the
extension needs a fallback (e.g. periodic JSONL-file-mtime polling) for
environments where shell integration doesn't activate.

**Surfacing status in tree views / webviews.**

- `vscode.TreeDataProvider` for the sidebar CRM view — Team → Agent → Session,
  directly modeled on ADE's hierarchy; refresh via `onDidChangeTreeData`
  fired from a `FileSystemWatcher` on the relevant `.claude/projects/**/*.jsonl`
  paths and/or the `.harness/agents/*.md` files.
- A webview panel for the "Agent Files" / memory-growth view (ADE's right-hand
  panel) — watch `.harness/memories/<agent>.md` and `.harness/team-memories/team.md`
  with `createFileSystemWatcher` and postMessage updates into the webview: no
  new memory format needed, this repo's harness memory files already are that
  store, per the `agent-runtime-interop` skill.
- Diff review: don't build a custom diff viewer — invoke the built-in Git
  extension's compare commands (`git.openChange` / `vscode.diff`) pointed at
  the worktree, mirroring Conductor's decision to lean on native SCM tooling
  rather than reinvent it.

**Activation/lifecycle constraints** (per the `vscode-extension-dev` skill,
already codified in this repo): narrow activation events only
(`onView:`/`onCommand:`, never `*`); no I/O in `activate()` beyond cheap sync
setup — agent/session data loads lazily when the tree view opens; every
terminal/watcher/webview must be pushed to `context.subscriptions`.

---

## 5. Synthesis — MVP recommendation

**MVP = the intersection of what's cheap in VS Code and what each product
proved is the highest-value primitive:**

1. **Worktree-per-session workspace management** (from Conductor): a command
   to create a named session → `git worktree add` + branch, and a matching
   "archive" command to remove it after merge. This is the foundational
   primitive everything else attaches to.
2. **Team → Agent → Session tree view** (from ADE): sidebar `TreeDataProvider`
   backed directly by `.harness/agents/*.md` (agent identities, already the
   CRM's "backing store" per the `agent-runtime-interop` skill) plus one
   session node per active worktree/terminal. No new data model — the
   harness's markdown+frontmatter files _are_ the agent roster already.
3. **Session launch via integrated terminal**, one per session tab, `claude`
   run with `cwd` set to the worktree (from ADE + the existing skill
   guidance). Runtime/model switching = editing `model:` frontmatter, exposed
   as a tree-item context-menu action.
4. **Working/blocked/done status badges** (from Herdr, adapted): combine
   Shell Integration command-start/end events (reliable "running a command"
   signal, when available) with a best-effort tail-read of the session's
   `~/.claude/projects/**/*.jsonl` file (last event type → assistant message
   = idle/done, tool call = working, permission-mode change = blocked) to
   badge each session node in the tree view. Ship with a documented
   "best-effort, may lag" caveat given the undocumented JSONL format.
5. **Diff review via native SCM**, not a custom viewer: a command on each
   session node that opens VS Code's built-in diff/compare view scoped to
   that worktree (from Conductor's "don't reinvent the diff viewer" choice).
6. **Memory panel deferred to v1.1, not MVP**: the harness memory files
   already exist and are useful read via plain `Read`/editor tabs; a live
   webview "memory growing" view (ADE's nicest UX touch) is a good fast-follow
   once the tree view and worktree lifecycle are solid, but isn't required to
   validate the core loop.

**Explicitly out of scope for MVP:** Herdr's SSH/remote multiplexing (VS Code
Remote-SSH already covers this at the editor level, no need to duplicate),
Herdr's programmatic JSON socket / agent-spawns-agent orchestration (v2 at
earliest — Claude Code's own subagent mechanism already covers the common
case), and any custom diff/merge UI (native SCM covers it, per Conductor's own
choice not to build one).

**Component mapping:**

| Feature                     | VS Code component                                                      |
| --------------------------- | ---------------------------------------------------------------------- |
| Session workspace           | `git worktree` via child_process + `createTerminal({cwd})`             |
| Team/Agent/Session nav      | `TreeDataProvider` (3-level), sourced from `.harness/agents/*.md`      |
| Agent launch/runtime switch | `createTerminal` + frontmatter edit via `Edit`-equivalent (fs write)   |
| Status badges               | Shell Integration API + best-effort JSONL tail via `FileSystemWatcher` |
| Diff review                 | Built-in Git extension commands scoped to worktree path                |
| Archive/cleanup             | Command wrapping `git worktree remove` + branch cleanup                |
| Memory view (fast-follow)   | Webview panel + `FileSystemWatcher` on `.harness/memories/`            |

---

## Open questions / follow-ups for a future research pass

- Content of `~/.claude/sessions/<pid>.json` and `~/.claude/tasks/<uuid>/` not
  inspected — could offer a cheaper "is process alive" signal than JSONL
  tailing; worth a follow-up before building the status-badge feature.
- Conductor's notification system and keyboard shortcuts are not documented
  publicly beyond the docs index page fetched here — the docs site has deeper
  pages (`/docs/workflow`, `/docs/parallel-agents`, `/docs/diff-viewer`, `/docs/review-checks`)
  not individually fetched this pass.
- Herdr's exact state-detection heuristic (working/blocked/done) is not
  publicly documented; the "compare" page may have more detail and wasn't
  fetched this pass.
- Claude Code's `Stop`/`SubagentStop` hook semantics (referenced above for a
  possible reflection-loop port) should be verified against current Claude
  Code hook docs before depending on them in an implementation.
