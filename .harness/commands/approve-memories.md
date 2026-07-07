---
name: approve-memories
description: Review pending team-memory proposals and merge approved ones into team memory.
disable-model-invocation: true
---

Process `.harness/team-memories/.pending/` against the protocol in
`.harness/protocol/memory-protocol.md`.

1. List every `.md` file in `.pending/`. If none: report "no pending proposals"
   and stop.
2. Run the protocol's hygiene checks on each (duplicate check against `team.md`,
   injection scan). Present all proposals to the user in one batch — entry text,
   justification, your hygiene verdict — and ask approve/reject/edit per entry.
3. Merge approved entries into `.harness/team-memories/team.md` per the
   protocol's format and 4,000-char budget, consolidating first if the write
   would exceed it. Delete every processed proposal file (approved and rejected).
4. Run `npm run harness:sync-copilot` so the Copilot bridge picks up the new
   team memory.

Done only when `.pending/` is empty, `team.md` is within budget with an accurate
`used` count, and the sync script has run.
