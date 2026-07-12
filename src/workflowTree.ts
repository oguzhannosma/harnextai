import * as vscode from "vscode";
import {
  ExecFn,
  GitHubIssue,
  listOpenIssues,
  makeGhExec,
} from "./githubIssues";
import type { LiveSession } from "./liveSessionStore";
import type { WorkflowProgressQuery } from "./workflowProgressMonitor";

/**
 * TreeDataProvider for `harnextai.workflowIssuesView`. Lists open GitHub
 * issues via `gh issue list`; links to live `issue-*` sessions when present.
 */

/** A leaf issue node. Payload for Trigger / Open Session / Open on GitHub. */
export interface IssueNode {
  readonly kind: "issue";
  readonly issue: GitHubIssue;
}

/** Placeholder when the issue list is empty or `gh` failed. */
interface IssuesMessageNode {
  readonly kind: "issuesMessage";
  readonly message: string;
}

export type WorkflowIssuesNode = IssueNode | IssuesMessageNode;

/** Lookup live workflow session for an issue number. */
export type SessionForIssue = (issueNumber: number) => LiveSession | undefined;

export class WorkflowIssuesTreeProvider implements vscode.TreeDataProvider<WorkflowIssuesNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    WorkflowIssuesNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private issuesPromise: Promise<GitHubIssue[]> | undefined;
  private readonly exec: ExecFn;

  constructor(
    repoRoot: string,
    private readonly sessionForIssue: SessionForIssue = () => undefined,
    private readonly progress: WorkflowProgressQuery | undefined = undefined,
    exec: ExecFn = makeGhExec(repoRoot),
  ) {
    this.exec = exec;
  }

  refresh(): void {
    this.issuesPromise = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: WorkflowIssuesNode): vscode.TreeItem {
    if (node.kind === "issue") {
      return issueItem(node.issue, this.sessionForIssue, this.progress);
    }
    return messageItem(node.message);
  }

  async getChildren(): Promise<WorkflowIssuesNode[]> {
    let issues: GitHubIssue[];
    try {
      issues = await this.getIssues();
    } catch (err) {
      return [
        {
          kind: "issuesMessage",
          message: `gh issue list failed: ${errText(err)}`,
        },
      ];
    }
    if (issues.length === 0) {
      return [{ kind: "issuesMessage", message: "No open issues" }];
    }
    return issues.map((issue) => ({ kind: "issue", issue }));
  }

  private getIssues(): Promise<GitHubIssue[]> {
    return (this.issuesPromise ??= listOpenIssues(this.exec));
  }
}

function issueItem(
  issue: GitHubIssue,
  sessionForIssue: SessionForIssue,
  progress: WorkflowProgressQuery | undefined,
): vscode.TreeItem {
  const session = sessionForIssue(issue.number);
  const highlight = progress?.getHighlightForIssue(issue.number);
  const item = new vscode.TreeItem(
    `#${issue.number} ${issue.title}`,
    vscode.TreeItemCollapsibleState.None,
  );
  const bits: string[] = [];
  if (session && highlight) {
    bits.push(`${highlight.step} · ${highlight.status}`);
  } else if (session) {
    bits.push("session");
  }
  if (issue.labels.length > 0) {
    bits.push(issue.labels.join(", "));
  }
  if (bits.length > 0) {
    item.description = bits.join(" · ");
  }
  item.tooltip = new vscode.MarkdownString(
    `**#${issue.number}** ${issue.title}\n\n` +
      (issue.labels.length > 0
        ? `Labels: ${issue.labels.join(", ")}\n\n`
        : "") +
      (session
        ? `Workflow session: \`${session.slug}\`` +
          (highlight ? ` — ${highlight.step} (${highlight.status})` : "") +
          "\n\n"
        : "") +
      (issue.url ? `[Open on GitHub](${issue.url})` : ""),
  );
  item.iconPath = new vscode.ThemeIcon(session ? "git-branch" : "issue-opened");
  item.contextValue = session ? "githubIssueWithSession" : "githubIssue";
  return item;
}

function messageItem(message: string): vscode.TreeItem {
  const item = new vscode.TreeItem(
    message,
    vscode.TreeItemCollapsibleState.None,
  );
  item.iconPath = new vscode.ThemeIcon("info");
  item.contextValue = "workflowMessage";
  return item;
}

function errText(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: unknown; message?: unknown };
    if (typeof e.stderr === "string" && e.stderr.trim() !== "") {
      return e.stderr.trim();
    }
    if (typeof e.message === "string" && e.message.trim() !== "") {
      return e.message.trim();
    }
  }
  return String(err);
}
