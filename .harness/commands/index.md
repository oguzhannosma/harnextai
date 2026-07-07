---
name: index
description: Rebuild the project index by dispatching the Indexer agent.
disable-model-invocation: true
---

Dispatch the `indexer` agent (defined at `.harness/agents/indexer.md`) as a
subagent to rebuild `.harness/project-index/`. Pass along any scope the user
gave (e.g. "just the webview modules").

When it returns, report: which map entries were added, updated, or removed, and
confirm `.harness/last-index-commit` now matches `git rev-parse HEAD`.
If they don't match, the run failed — say so, don't paper over it.
