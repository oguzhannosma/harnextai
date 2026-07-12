import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { loadHarnessWorkflow } from "./harnessWorkflow";
import {
  WorkflowGraphHostMessage,
  WorkflowGraphView,
  isWorkflowGraphWebviewMessage,
} from "./shared/messages";
import type { WorkflowProgressQuery } from "./workflowProgressMonitor";
import type { WorkflowProgressStatus } from "./workflowProgress";

const VIEW_TYPE = "harnextai.workflowView";

/**
 * Sidebar webview: compact icon flow from harness.json, with optional active-step
 * highlight from session `progress.md`, waiting-you actions, and done celebrate.
 */
export class WorkflowGraphViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private lastStatusByIssue = new Map<number, WorkflowProgressStatus>();
  private pendingCelebrate = false;

  constructor(
    private readonly mediaUri: vscode.Uri,
    private readonly repoRoot: string,
    private readonly progressQuery: WorkflowProgressQuery,
    private readonly onContinue: (issue: number) => Promise<void>,
    private readonly onOpenTerminal: (issue: number) => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.mediaUri],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((raw) => {
      void this.onMessage(raw);
    });
    void this.push();
  }

  refresh(): void {
    void this.push();
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isWorkflowGraphWebviewMessage(raw)) {
      console.warn("harnextai: dropped invalid workflow-graph message", raw);
      return;
    }
    if (raw.type === "ready") {
      await this.push();
      return;
    }
    if (raw.type === "continueWorkflow") {
      await this.onContinue(raw.issue);
      await this.push();
      return;
    }
    if (raw.type === "openWorkflowTerminal") {
      this.onOpenTerminal(raw.issue);
    }
  }

  private async push(): Promise<void> {
    if (!this.view) {
      return;
    }
    const result = await loadHarnessWorkflow(this.repoRoot);
    if (!result.ok) {
      this.post({ type: "workflowError", message: result.error });
      return;
    }
    const highlight = this.progressQuery.getHighlight();
    let celebrateDone = false;
    if (highlight) {
      const prev = this.lastStatusByIssue.get(highlight.issue);
      if (highlight.status === "done" && prev !== "done") {
        celebrateDone = true;
        this.pendingCelebrate = true;
      }
      this.lastStatusByIssue.set(highlight.issue, highlight.status);
    }
    if (
      this.pendingCelebrate &&
      !celebrateDone &&
      highlight?.status === "done"
    ) {
      celebrateDone = true;
    }
    // Clear after one push that includes celebrate.
    if (celebrateDone) {
      this.pendingCelebrate = false;
    }

    const data: WorkflowGraphView = {
      trigger: result.workflow.trigger,
      steps: result.workflow.steps.map((s) => ({
        step: s.step,
        action: s.action,
      })),
      ...(highlight
        ? {
            activeStepIndex: highlight.activeStepIndex,
            progressStatus: highlight.status,
            progressIssue: highlight.issue,
            progressStep: highlight.step,
            progressUpdatedAt: highlight.updatedAt,
            progressNote: highlight.note,
            celebrateDone,
          }
        : {}),
    };
    this.post({ type: "workflow", data });
  }

  private post(message: WorkflowGraphHostMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "workflow.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "workflow.css"),
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link href="${styleUri}" rel="stylesheet" />
	<title>Workflow</title>
</head>
<body>
	<main id="root"></main>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export { VIEW_TYPE as WORKFLOW_GRAPH_VIEW_ID };
