<!-- proposal: append to team-memories/team.md -->

- Form editor markdown bodies (agent system prompt, skill body, memory entries) use Text|Preview tabs in the webview; Preview renders via DOM nodes only (no `innerHTML`). File-path refs (`[text](path)`, backticks, bare `src/`/`.harness/` paths) post `{ type: "openFile", path }` (validated in `src/shared/messages.ts`); host opens via `openTextDocument`/`showTextDocument` resolved against the workspace folder. Path heuristics live in `src/shared/filePaths.ts`.
- Agents tree enables `canSelectMany: true`. `intelligents.deleteSession` / `deleteHistorySession` accept `(focused, selected[])` from multi-select context menus; multi-delete confirms once then runs with `skipConfirm` (live) or a single history confirm. Unmerged-branch force prompts still apply per branch.

Justification: durable UX/protocol conventions for form preview + bulk session delete that future agents will otherwise rediscover by reading several files.
