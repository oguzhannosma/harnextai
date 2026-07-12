/**
 * Default harness workflow written on bootstrap and used when the user
 * declines to define a custom flow during harness-architect Setup.
 */

export interface DefaultWorkflowStep {
  readonly step: string;
  readonly action: string;
}

export interface DefaultWorkflow {
  readonly trigger: string;
  readonly steps: readonly DefaultWorkflowStep[];
}

/** Sensible GitHub-issue ticket flow for Harnext AI / general harness projects. */
export const DEFAULT_HARNESS_WORKFLOW: DefaultWorkflow = {
  trigger:
    "user gives a ticket number — main thread fetches the issue (gh issue view <id>) and starts the workflow",
  steps: [
    {
      step: "researcher",
      action: "investigates the ticket and reports findings",
    },
    {
      step: "user-gate",
      action: "user reads findings and decides whether/how to proceed",
    },
    {
      step: "developer",
      action:
        "creates a ticket branch and implements the change; loops with user on feedback",
    },
    {
      step: "user-gate",
      action: "user tests manually and relays fixes until they say okay",
    },
    {
      step: "reviewer",
      action: "reviews the change; loops with developer until review is green",
    },
    {
      step: "developer",
      action: "commits, pushes the ticket branch, and opens the PR",
    },
    {
      step: "user",
      action: "merges the PR",
    },
  ],
};

/** Pretty-printed JSON fragment for prompts (trigger + steps only). */
export function defaultWorkflowJson(): string {
  return JSON.stringify(DEFAULT_HARNESS_WORKFLOW, null, 2);
}
