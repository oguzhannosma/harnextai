import { quotePromptArg } from "./liveSessionStore";

/**
 * Pure mapping from the user's chosen workflow runtime to the CLI invocation
 * that starts it. Owns everything that can be reasoned about without the
 * extension host — runtime validation, the CLI binary name, the git-branch agent
 * segment, the ticket-focused prompt, and the final quoted command line. It must
 * NOT import `vscode`: settings reading and the optional QuickPick live in the
 * extension wiring ({@link file://./extension.ts}), which passes the resolved
 * runtime here.
 *
 * Two runtimes are supported:
 *   - `claude` -> the Claude Code CLI (`claude <quoted-prompt>`)
 *   - `cursor` -> the Cursor CLI (`agent <quoted-prompt>`)
 *
 * Runtime settings apply to the Trigger Workflow flow only; existing
 * `launchAgent` / `newSession` stay on Claude Code (`claude --agent …`).
 */

/** Which CLI a workflow run launches. Persisted as an `harnextai.workflow.*` setting. */
export type WorkflowRuntime = "claude" | "cursor";

/** Narrow an untrusted settings value to a {@link WorkflowRuntime}. */
export function isWorkflowRuntime(value: unknown): value is WorkflowRuntime {
  return value === "claude" || value === "cursor";
}

/**
 * The git-branch agent segment for a runtime's session branch, e.g.
 * `claude/issue-42` or `cursor/issue-42` (see {@link branchFor}). Deliberately
 * matches the runtime key so branches read naturally.
 */
export function runtimeAgentName(runtime: WorkflowRuntime): string {
  return runtime === "claude" ? "claude" : "cursor";
}

/**
 * The CLI binary name to launch for a runtime. Claude Code is `claude`; the
 * Cursor CLI's interactive-session binary is `agent`.
 */
export function runtimeCli(runtime: WorkflowRuntime): string {
  return runtime === "claude" ? "claude" : "agent";
}

/** Human label for a runtime (QuickPick / messages). */
export function runtimeLabel(runtime: WorkflowRuntime): string {
  return runtime === "claude" ? "Claude Code" : "Cursor CLI";
}

/**
 * Ticket-id-focused opening prompt for a GitHub issue. Kept intentionally short:
 * it points the runtime at the issue number and lets its own subagent
 * orchestration take over, rather than pre-baking a plan into the prompt.
 */
export function issuePrompt(
  issueNumber: number,
  workflowTrigger?: string,
): string {
  const base =
    `Work on GitHub issue #${issueNumber}. ` +
    `Fetch it with gh issue view ${issueNumber}, ` +
    `then orchestrate harness subagents as needed. ` +
    `Maintain progress.md at the worktree root per .harness/protocol/workflow-progress.md ` +
    `(issue, step, stepIndex, status, updatedAt).`;
  const trigger = workflowTrigger?.trim();
  if (trigger) {
    return `${base} Project workflow: ${trigger}`;
  }
  return base;
}

/**
 * The full command line for a workflow run: the runtime's CLI binary followed by
 * the prompt quoted as a single shell argument (via {@link quotePromptArg}, which
 * survives whatever shell the integrated terminal runs). No `--agent` flag — the
 * runtime orchestrates subagents itself.
 */
export function buildRuntimeCommand(
  runtime: WorkflowRuntime,
  prompt: string,
): string {
  return `${runtimeCli(runtime)} ${quotePromptArg(prompt)}`;
}

/**
 * Command to reopen an existing workflow/agent session after its terminal closed.
 * Claude Code uses `--continue`; Cursor CLI re-enters the interactive `agent` TUI
 * in the worktree (no separate continue flag in the common CLI).
 */
export function buildContinueCommand(runtime: WorkflowRuntime): string {
  return runtime === "claude" ? "claude --continue" : "agent";
}
