import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Loads the harness workflow definition from `.harness/harness.json`.
 * Pure domain — no `vscode`. The Workflow graph webview and Trigger Workflow
 * prompt both read from here; order and duplicate steps are preserved as declared.
 */

/** One step in `harness.json` → `workflow.steps`. */
export interface HarnessWorkflowStep {
  readonly step: string;
  readonly action: string;
}

/** Parsed `workflow` block from harness.json. */
export interface HarnessWorkflow {
  readonly trigger: string;
  readonly steps: readonly HarnessWorkflowStep[];
}

export type HarnessWorkflowLoadResult =
  | { readonly ok: true; readonly workflow: HarnessWorkflow }
  | { readonly ok: false; readonly error: string };

function harnessJsonPath(repoRoot: string): string {
  return path.join(repoRoot, ".harness", "harness.json");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Parse a harness.json document's `workflow` block. Returns a clear error when
 * the block is missing or malformed. Preserves step order and duplicates.
 */
export function parseHarnessWorkflow(
  jsonText: string,
): HarnessWorkflowLoadResult {
  let root: unknown;
  try {
    root = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "harness.json is not valid JSON" };
  }
  if (!isRecord(root)) {
    return { ok: false, error: "harness.json root must be an object" };
  }
  const workflow = root.workflow;
  if (!isRecord(workflow)) {
    return { ok: false, error: "harness.json has no workflow block" };
  }
  const trigger = workflow.trigger;
  if (typeof trigger !== "string" || trigger.trim() === "") {
    return { ok: false, error: "workflow.trigger must be a non-empty string" };
  }
  const rawSteps = workflow.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    return { ok: false, error: "workflow.steps must be a non-empty array" };
  }
  const steps: HarnessWorkflowStep[] = [];
  for (let i = 0; i < rawSteps.length; i++) {
    const entry = rawSteps[i];
    if (!isRecord(entry)) {
      return { ok: false, error: `workflow.steps[${i}] must be an object` };
    }
    const step = entry.step;
    const action = entry.action;
    if (typeof step !== "string" || step.trim() === "") {
      return {
        ok: false,
        error: `workflow.steps[${i}].step must be a non-empty string`,
      };
    }
    if (typeof action !== "string" || action.trim() === "") {
      return {
        ok: false,
        error: `workflow.steps[${i}].action must be a non-empty string`,
      };
    }
    steps.push({ step: step.trim(), action: action.trim() });
  }
  return { ok: true, workflow: { trigger: trigger.trim(), steps } };
}

/** Read and parse `<repo>/.harness/harness.json`. */
export async function loadHarnessWorkflow(
  repoRoot: string,
): Promise<HarnessWorkflowLoadResult> {
  const filePath = harnessJsonPath(repoRoot);
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, error: ".harness/harness.json not found" };
    }
    return { ok: false, error: `Failed to read harness.json: ${String(err)}` };
  }
  return parseHarnessWorkflow(text);
}

/** True when a step id represents a human gate (styled differently in the graph). */
export function isGateStep(stepId: string): boolean {
  return stepId === "user-gate" || stepId === "user";
}
