# Harnext AI

<img src="media/icon.png" alt="Harnext AI" width="128" height="128" />

VS Code / Cursor extension for managing a project **harness** — agents, skills, memory, Doctor sync, and ticket workflows that run with Claude Code or the Cursor CLI.

**Repository:** [github.com/oguzhannosma/harnextai](https://github.com/oguzhannosma/harnextai)

## Features

- **Agents / Skills / Memory** — browse and edit `.harness/` sources
- **Initialize Harness** — bootstrap `.harness/`, pick Claude or Cursor, launch harness-architect
- **Doctor** — find stub drift and **Fix all** (syncs `.claude/` / `.cursor/` without a separate CLI)
- **Workflow** — graph, GitHub issues, sessions, and progress from `harness.json`

## Requirements

- VS Code / Cursor `^1.90.0`
- Optional: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI and/or [Cursor](https://cursor.com) `agent` CLI for terminal launches

## Install (development)

```bash
npm install
npm run build
```

Then **Extensions: Install from VSIX…** after `npm run package`, or press F5 to run the Extension Development Host.

## License

MIT — see [LICENSE](LICENSE).
