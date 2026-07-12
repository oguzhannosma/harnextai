import { parseDocument } from "./frontmatter";

/**
 * Parses `progress.md` written by agents in a workflow session worktree.
 * Pure domain — no `vscode`. Used by the Workflow graph to highlight the
 * active harness step.
 */

export type WorkflowProgressStatus =
  "active" | "waiting-user" | "done" | "blocked";

export interface WorkflowProgress {
  readonly issue: number;
  readonly step: string;
  readonly stepIndex: number;
  readonly status: WorkflowProgressStatus;
  /** Optional body text after frontmatter. */
  readonly note: string;
  readonly updatedAt: string;
}

export type WorkflowProgressParseResult =
  | { readonly ok: true; readonly progress: WorkflowProgress }
  | { readonly ok: false; readonly error: string };

const VALID_STATUS = new Set<string>([
  "active",
  "waiting-user",
  "done",
  "blocked",
]);

function parsePositiveInt(
  raw: string | undefined,
  field: string,
): number | string {
  if (raw === undefined || raw.trim() === "") {
    return `missing ${field}`;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    return `invalid ${field}`;
  }
  return n;
}

/** Parse progress file contents (frontmatter + optional note body). */
export function parseWorkflowProgress(
  content: string,
): WorkflowProgressParseResult {
  const doc = parseDocument(content);
  if (!doc.hasFrontmatter) {
    return { ok: false, error: "progress.md has no frontmatter" };
  }
  const fm = doc.frontmatter;

  const issueRaw = parsePositiveInt(fm.issue, "issue");
  if (typeof issueRaw === "string") {
    return { ok: false, error: issueRaw };
  }

  const stepIndexRaw = parsePositiveInt(fm.stepIndex, "stepIndex");
  if (typeof stepIndexRaw === "string") {
    return { ok: false, error: stepIndexRaw };
  }

  const step = fm.step?.trim() ?? "";
  if (step === "") {
    return { ok: false, error: "missing step" };
  }

  const status = fm.status?.trim() ?? "";
  if (!VALID_STATUS.has(status)) {
    return { ok: false, error: "invalid status" };
  }

  return {
    ok: true,
    progress: {
      issue: issueRaw,
      step,
      stepIndex: stepIndexRaw,
      status: status as WorkflowProgressStatus,
      note: doc.body.trim(),
      updatedAt: fm.updatedAt?.trim() ?? "",
    },
  };
}

/** Highlight payload pushed to the Workflow webview / session trees. */
export interface WorkflowProgressHighlight {
  readonly activeStepIndex: number;
  readonly status: WorkflowProgressStatus;
  readonly issue: number;
  /** Current step id from progress.md (e.g. `researcher`). */
  readonly step: string;
  /** ISO timestamp from progress.md `updatedAt`. */
  readonly updatedAt: string;
  /** Optional note body from progress.md. */
  readonly note: string;
}

export interface WorkflowProgressWriteInput {
  readonly issue: number;
  readonly step: string;
  readonly stepIndex: number;
  readonly status: WorkflowProgressStatus;
  readonly updatedAt?: string;
  readonly note?: string;
}

/** Serialize progress frontmatter + optional note (agents and extension seeding). */
export function formatProgressMarkdown(
  input: WorkflowProgressWriteInput,
): string {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const front = [
    "---",
    `issue: ${input.issue}`,
    `step: ${input.step}`,
    `stepIndex: ${input.stepIndex}`,
    `status: ${input.status}`,
    `updatedAt: ${updatedAt}`,
    "---",
  ].join("\n");
  const note = input.note?.trim();
  return note ? `${front}\n\n${note}\n` : `${front}\n`;
}
