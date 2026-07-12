import * as vscode from "vscode";
import type {
  WorkflowProgressHighlight,
  WorkflowProgressStatus,
} from "./workflowProgress";

/**
 * Opt-in OS notifications when a workflow session needs human attention
 * (`waiting-user` or `blocked`). Tracks last-seen status per issue so we only
 * fire on transitions, not every poll.
 */

const SETTING = "harnextai.workflow.notifyOnAttention";

export class WorkflowAttentionNotifier {
  private readonly lastStatus = new Map<number, WorkflowProgressStatus>();

  /**
   * Compare the latest highlight to the previous one; show a notification when
   * status newly becomes waiting-user or blocked (and the setting is on).
   */
  observe(highlight: WorkflowProgressHighlight | undefined): void {
    if (!highlight) {
      return;
    }
    const prev = this.lastStatus.get(highlight.issue);
    this.lastStatus.set(highlight.issue, highlight.status);
    if (prev === highlight.status) {
      return;
    }
    if (highlight.status !== "waiting-user" && highlight.status !== "blocked") {
      return;
    }
    const config = vscode.workspace.getConfiguration("harnextai.workflow");
    if (!config.get<boolean>("notifyOnAttention", false)) {
      return;
    }
    const title =
      highlight.status === "waiting-user"
        ? `Workflow #${highlight.issue} needs you`
        : `Workflow #${highlight.issue} is blocked`;
    const detail =
      highlight.note.trim() ||
      `Step \`${highlight.step}\` is ${highlight.status}.`;
    void vscode.window
      .showInformationMessage(
        `${title} — ${detail}`,
        "Open Workflow",
        "Open Terminal",
      )
      .then((choice) => {
        if (choice === "Open Workflow") {
          void vscode.commands.executeCommand("harnextai.workflowView.focus");
        } else if (choice === "Open Terminal") {
          void vscode.commands.executeCommand(
            "harnextai.openWorkflowTerminalByIssue",
            highlight.issue,
          );
        }
      });
  }

  /** Forget status for issues no longer watched (optional cleanup). */
  prune(activeIssues: ReadonlySet<number>): void {
    for (const issue of this.lastStatus.keys()) {
      if (!activeIssues.has(issue)) {
        this.lastStatus.delete(issue);
      }
    }
  }
}
