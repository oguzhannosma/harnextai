# Workflow progress (`progress.md`)

Agents running a harness workflow (Trigger Workflow on a GitHub issue) must
keep a small progress file so the Intelligents Workflow graph can highlight the
active step.

## Location

Write at the **worktree root** (session cwd):

```text
progress.md
```

For issue workflows this is typically
`.harness/agent-session-works/issue-<N>/progress.md` (gitignored).

## Format

YAML frontmatter + optional one-line note:

```markdown
---
issue: 42
step: researcher
stepIndex: 0
status: active
updatedAt: 2026-07-12T12:00:00Z
---

Optional short note for humans.
```

| Field       | Required    | Meaning                                                                                           |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `issue`     | yes         | GitHub issue number                                                                               |
| `step`      | yes         | Must match `workflow.steps[].step` in `.harness/harness.json`                                     |
| `stepIndex` | yes         | **0-based** index into `workflow.steps` (required when the same `step` id appears more than once) |
| `status`    | yes         | `active` \| `waiting-user` \| `done` \| `blocked`                                                 |
| `updatedAt` | recommended | ISO-8601; bump on every write                                                                     |

## Rules

1. Create or **overwrite** `progress.md` when you start each harness step.
2. Set `step` and `stepIndex` **before** doing work for that step.
3. On user gates (`user-gate`, `user`), use `status: waiting-user`.
4. When the full workflow is finished, set `status: done` (keep last step fields).
5. Never delete the file; only overwrite.

## Example (waiting on user)

```markdown
---
issue: 42
step: user-gate
stepIndex: 1
status: waiting-user
updatedAt: 2026-07-12T12:15:00Z
---

Findings ready — waiting for go/no-go.
```

Main orchestrator and subagents should follow this protocol whenever they
advance the harness workflow for an issue.
