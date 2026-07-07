---
name: agent-runtime-interop
description: Domain knowledge for integrating with Claude Code and GitHub Copilot. Use when reading or writing agent/skill definitions, spawning Claude Code terminals, parsing ~/.claude data, or bridging context to Copilot.
---

# Agent runtime interop — Claude Code & Copilot

The product manages agents that _run in other tools_. This skill holds what the
extension may assume about those tools. **Formats below drift with tool
releases — verify against the user's installed version (`claude --version`)
before building on them, and record confirmed formats in team memory.**

## Claude Code (primary runtime)

- Agent definitions: markdown + YAML frontmatter (`name`, `description`,
  `model`, `tools`) in `<repo>/.claude/agents/*.md` (project) and
  `~/.claude/agents/*.md` (user). Skills: `.claude/skills/<name>/SKILL.md`
  (frontmatter: `name`, `description`, optional `disable-model-invocation`).
  These files are the CRM's backing store — the extension reads/writes them
  directly; no hidden database.
- Launching: create a VS Code integrated terminal per agent session
  (`window.createTerminal`) running `claude`; one terminal per session tab,
  named after the agent. Interact via the terminal; do not scrape its output —
  treat session state as opaque unless a documented format is confirmed.
- Model switching = editing the `model:` frontmatter field.

## GitHub Copilot (secondary)

- No public extension API for driving Copilot chat. Integration is file-based:
  `.github/copilot-instructions.md` (repo-wide context) is the bridge surface.
  The CRM regenerates it from agent/memory data (see
  `.harness/scripts/sync-copilot.ts` for the pattern).
- Detect Copilot via `vscode.extensions.getExtension('GitHub.copilot')`; degrade
  gracefully when absent.

## Safety rules

- Treat all files under `~/.claude` as user-owned: read freely, write only the
  specific file the user acted on, never delete.
- Parse frontmatter defensively (missing fields, unknown keys preserved on
  round-trip) — a lossy rewrite of a user's agent file is data loss.
