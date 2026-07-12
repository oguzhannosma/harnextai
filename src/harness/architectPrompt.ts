import { buildRuntimeCommand, type WorkflowRuntime } from "../workflowRuntime";
import { defaultWorkflowJson } from "./defaultWorkflow";

export type ArchitectTaskKind = "setup" | "extend-agent" | "extend-skill";

export interface ArchitectBrief {
  kind: ArchitectTaskKind;
  name: string;
  purpose: string;
  notes?: string;
}

function skillPath(_repoRoot: string): string {
  return ".harness/skills/harness-architect/SKILL.md";
}

const NO_CLI_RULE =
  "CRITICAL: Do NOT run osma-harness, osma-harness-cli, bunx osma-harness*, or any harness CLI. " +
  "Only write files under .harness/. Tool stubs (.claude/, .cursor/) are synced by the user via Harnext AI Doctor → Fix all.";

export function buildArchitectPrompt(
  repoRoot: string,
  brief: ArchitectBrief,
): string {
  const skill = skillPath(repoRoot);
  const notes = brief.notes?.trim()
    ? `\nAdditional notes from the user: ${brief.notes.trim()}`
    : "";

  let task: string;
  switch (brief.kind) {
    case "setup":
      task = [
        "Branch: **Setup**. Interview the user briefly if needed, then design and write the initial harness roster, skills, and harness.json agents list for this project.",
        "",
        "**Workflow (required):** Ask the user how their ticket/PR workflow should look — trigger (how work starts), ordered steps (agent names + what each does), and any user gates.",
        "Write the answer into `harness.json` as a `workflow` object with `trigger` (string) and `steps` (array of `{ step, action }`).",
        "If the user skips, declines, or says they want the default / no custom workflow, keep or write this default workflow exactly:",
        "```json",
        defaultWorkflowJson(),
        "```",
        "Do not leave `workflow` missing from harness.json.",
        "When done, tell the user to open Harnext AI Doctor and click Fix all. No {{placeholders}} in generated files.",
      ].join("\n");
      break;
    case "extend-agent":
      task =
        `Branch: **Extend**. Create a new harness agent "${brief.name}" at .harness/agents/${brief.name}.md. ` +
        `Purpose: ${brief.purpose}. Add the agent to harness.json agents[]. ` +
        `Do not write .claude/ or .cursor/ stubs. No {{placeholders}} in generated files.`;
      break;
    case "extend-skill":
      task =
        `Branch: **Extend**. Create a new harness skill "${brief.name}" at .harness/skills/${brief.name}/SKILL.md ` +
        `(plus supporting files if needed). Purpose: ${brief.purpose}. ` +
        `Do not write tool copies under .claude/skills or .cursor/skills. No {{placeholders}}.`;
      break;
  }

  return [
    `You are the harness-architect for this project. Read and follow @${skill} (and its sibling docs in .harness/skills/harness-architect/).`,
    NO_CLI_RULE,
    task,
    notes,
    "When finished, tell the user to open the Harnext AI Doctor view and click Fix all to sync .claude/.cursor stubs.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildArchitectCommand(
  runtime: WorkflowRuntime,
  repoRoot: string,
  brief: ArchitectBrief,
): string {
  const prompt = buildArchitectPrompt(repoRoot, brief);
  return buildRuntimeCommand(runtime, prompt);
}

/** Launch prompt for post-bootstrap setup interview. */
export function buildSetupArchitectCommand(
  runtime: WorkflowRuntime,
  repoRoot: string,
): string {
  return buildRuntimeCommand(
    runtime,
    buildArchitectPrompt(repoRoot, {
      kind: "setup",
      name: "harness",
      purpose: "Design the initial agent team and harness for this repository.",
    }),
  );
}
