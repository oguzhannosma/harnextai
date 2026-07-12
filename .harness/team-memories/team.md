<!-- budget: 4000 | used: 2292 -->
<!-- proposal: append to team-memories/team.md -->

- Full inspiration research (Conductor/damon-ade/Herdr + VS Code feasibility + MVP rec) lives at docs/research/2026-07-07-inspirations-and-vscode-feasibility.md.

---

- `~/.claude` session transcripts: `~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl`, newline-delimited JSON records with `type` (`mode`, `permission-mode`, `attachment`, `user`, `assistant`, ...), `sessionId`, `timestamp`, `cwd`, `parentUuid` chain. Verified locally on Claude Code 2.1.202, Windows, 2026-07-07. Format is undocumented/internal — parse defensively, re-verify against `claude --version` before relying on it.

---

- No native `vscode.git` worktree API — extension must shell out to `git worktree add/remove` directly; use built-in Git extension only for diff/compare commands (`vscode.diff`), not worktree lifecycle.

---

- VS Code Terminal Shell Integration API (bash/fish/pwsh/zsh macOS/Linux, Git Bash/pwsh Windows) gives command start/end + exit code + cwd without polling, but silently degrades to "basic"/"none" for unsupported `$PROMPT_COMMAND`, shell plugins unsetting `$VSCODE_SHELL_INTEGRATION`, or old shells — any "is a command running" feature needs a fallback (e.g. file-mtime polling), not a hard dependency on rich shell integration.

---

- Market research on "what developers want from agentic coding tools" (2026, web
  search evidence) lives at docs/research/2026-07-08-what-people-want.md. Key
  takeaway for `intelligents`: VS Code 1.120 shipped a _native_ "Agents window"
  with a session sidebar (group/pin/rename/drag-drop) and Changes panel —
  direct platform overlap risk, differentiate via multi-runtime worktree CRM
  depth (Conductor/Claude Squad/Nimbalyst-style) rather than session listing
  alone. Top developer asks: cost/token visibility per session (Uber/Microsoft
  hit runaway Claude Code bills in 2026), context-engineering support (teams
  with agent context files see 40% fewer errors/55% faster per Anthropic's 2026
  report), fast human-in-the-loop diff review (reviewing overtook writing as
  the top AI time-sink Q1 2026), and worktree cleanup/archive as first-class
  (Conductor's "archive" step, missing from raw git worktree tooling).

direction for all agents working on this repo, not just this session.
