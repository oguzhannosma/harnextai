import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { LiveSession, issueNumberFromSlug } from "./liveSessionStore";
import {
  WorkflowSessionsHostMessage,
  WorkflowSessionCard,
  isWorkflowSessionsWebviewMessage,
} from "./shared/messages";
import type { WorkflowProgressQuery } from "./workflowProgressMonitor";

const VIEW_TYPE = "harnextai.workflowSessionsView";

/** Minimal session source for the Sessions cards webview. */
export interface WorkflowSessionSource {
  allSessions(): readonly LiveSession[];
}

/**
 * Sidebar webview of workflow session cards (issue runs) with Open / Delete.
 */
export class WorkflowSessionsViewProvider
  implements vscode.WebviewViewProvider
{
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly mediaUri: vscode.Uri,
    private readonly sessions: WorkflowSessionSource,
    private readonly progress: WorkflowProgressQuery,
    private readonly onOpen: (session: LiveSession) => void,
    private readonly onDelete: (session: LiveSession) => Promise<void>,
    private readonly issueTitle: (issue: number) => string | undefined,
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
    this.push();
  }

  refresh(): void {
    this.push();
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isWorkflowSessionsWebviewMessage(raw)) {
      console.warn("harnextai: dropped invalid sessions message", raw);
      return;
    }
    if (raw.type === "ready") {
      this.push();
      return;
    }
    const session = this.sessions
      .allSessions()
      .find((s) => !s.archived && s.slug === raw.slug);
    if (!session) {
      return;
    }
    if (raw.type === "openSession") {
      this.onOpen(session);
      return;
    }
    if (raw.type === "deleteSession") {
      await this.onDelete(session);
      this.push();
    }
  }

  private push(): void {
    if (!this.view) {
      return;
    }
    const cards: WorkflowSessionCard[] = this.sessions
      .allSessions()
      .filter((s) => !s.archived && s.slug.startsWith("issue-"))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((session) => {
        const issue = issueNumberFromSlug(session.slug) ?? 0;
        const highlight = this.progress.getHighlightForSlug(session.slug);
        const title =
          this.issueTitle(issue) ??
          (issue > 0 ? `Issue #${issue}` : session.slug);
        return {
          slug: session.slug,
          issue,
          title,
          step: highlight?.step ?? "…",
          status: highlight?.status ?? "unknown",
          runtime: session.runtime ?? session.agentName,
          createdAt: session.createdAt,
          worktreePath: session.worktreePath,
          note: highlight?.note ?? "",
        };
      });
    this.post({ type: "sessions", data: { sessions: cards } });
  }

  private post(message: WorkflowSessionsHostMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "sessions.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "sessions.css"),
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
	<title>Sessions</title>
</head>
<body>
	<main id="root"></main>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export { VIEW_TYPE as WORKFLOW_SESSIONS_VIEW_ID };
