import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  formatProgressMarkdown,
  parseWorkflowProgress,
} from "./workflowProgress";

/**
 * Flip a waiting-user / blocked progress.md back to `active` so the agent can
 * proceed. Pure file I/O — no vscode. Returns false if the file is missing or
 * invalid.
 */
export async function resumeProgressFile(
  worktreePath: string,
): Promise<boolean> {
  const filePath = path.join(worktreePath, "progress.md");
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return false;
  }
  const parsed = parseWorkflowProgress(text);
  if (!parsed.ok) {
    return false;
  }
  const { progress } = parsed;
  await fs.writeFile(
    filePath,
    formatProgressMarkdown({
      issue: progress.issue,
      step: progress.step,
      stepIndex: progress.stepIndex,
      status: "active",
      note:
        progress.note.trim() ||
        "User approved from the Workflow panel — continue.",
    }),
    "utf8",
  );
  return true;
}
