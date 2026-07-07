import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { loadMemoryPanel } from "./memoryPanelModel";
import { isReadyMessage, MemoryPanelHostMessage } from "./shared/messages";

/**
 * Owns the single reusable read-only "live memory" webview: every memory file
 * rendered as a budget-barred section, updating on disk changes without user
 * action (the damon-ade "watch the agent's memory grow" panel).
 *
 * Security posture matches {@link file://./transcriptPanel.ts} and the webview-ui
 * checklist: strict CSP, nonce'd script, `asWebviewUri` with `localResourceRoots`
 * pinned to `media/`, one-directional data (host pushes, webview renders +
 * `ready`), `retainContextWhenHidden: false`.
 *
 * Live updates come from this panel's OWN {@link vscode.FileSystemWatcher}s over
 * the memory globs — created when the panel opens, disposed when it closes. They
 * are separate from the tree's watchers and only re-push to this webview; they
 * never touch the tree (no double-fire).
 */
export class MemoryPanelView {
  private panel: vscode.WebviewPanel | undefined;
  private readonly watchers: vscode.FileSystemWatcher[] = [];

  constructor(
    private readonly mediaUri: vscode.Uri,
    private readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly memoriesDir: string,
    private readonly teamMemoryPath: string,
  ) {}

  /** Open (or refocus) the panel and push the current memory state. */
  async open(): Promise<void> {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "intelligents.memory",
        "Live Memory",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: false,
          localResourceRoots: [this.mediaUri],
        },
      );
      this.panel.webview.html = this.html(this.panel.webview);
      this.panel.onDidDispose(() => {
        this.disposeWatchers();
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw));
      this.startWatching();
    }

    this.panel.reveal(vscode.ViewColumn.Active);
    await this.push();
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isReadyMessage(raw)) {
      console.warn("intelligents: dropped invalid memory-panel message", raw);
      return;
    }
    await this.push();
  }

  /** Watch the personal + team memory files; any change re-reads and re-pushes. */
  private startWatching(): void {
    const globs = [".harness/memories/*.md", ".harness/team-memories/team.md"];
    for (const glob of globs) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(this.workspaceFolder, glob),
      );
      const onEvent = () => void this.push();
      watcher.onDidCreate(onEvent);
      watcher.onDidChange(onEvent);
      watcher.onDidDelete(onEvent);
      this.watchers.push(watcher);
    }
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers.length = 0;
  }

  private async push(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const data = await loadMemoryPanel(this.memoriesDir, this.teamMemoryPath);
    this.post({ type: "memory", data });
  }

  private post(message: MemoryPanelHostMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "memory.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "memory.css"),
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
	<title>Live Memory</title>
</head>
<body>
	<main id="root"></main>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposeWatchers();
    this.panel?.dispose();
  }
}
