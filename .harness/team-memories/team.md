<!-- budget: 4000 | used: 1288 -->
<!-- proposal: append to team-memories/team.md -->

- Full inspiration research (Conductor/damon-ade/Herdr + VS Code feasibility + MVP rec) lives at docs/research/2026-07-07-inspirations-and-vscode-feasibility.md.

---

- `~/.claude` session transcripts: `~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl`, newline-delimited JSON records with `type` (`mode`, `permission-mode`, `attachment`, `user`, `assistant`, ...), `sessionId`, `timestamp`, `cwd`, `parentUuid` chain. Verified locally on Claude Code 2.1.202, Windows, 2026-07-07. Format is undocumented/internal — parse defensively, re-verify against `claude --version` before relying on it.

---

- No native `vscode.git` worktree API — extension must shell out to `git worktree add/remove` directly; use built-in Git extension only for diff/compare commands (`vscode.diff`), not worktree lifecycle.

---

- VS Code Terminal Shell Integration API (bash/fish/pwsh/zsh macOS/Linux, Git Bash/pwsh Windows) gives command start/end + exit code + cwd without polling, but silently degrades to "basic"/"none" for unsupported `$PROMPT_COMMAND`, shell plugins unsetting `$VSCODE_SHELL_INTEGRATION`, or old shells — any "is a command running" feature needs a fallback (e.g. file-mtime polling), not a hard dependency on rich shell integration.
