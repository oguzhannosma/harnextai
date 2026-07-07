import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { loadTranscript } from "./transcript";
import { isReadyMessage, TranscriptHostMessage } from "./shared/messages";

/**
 * Owns the single reusable read-only transcript webview. One panel is reused
 * across sessions (webview-ui state model): viewing a different transcript pushes
 * fresh state rather than spawning panels.
 *
 * Security posture (webview-ui checklist):
 *  - strict CSP `default-src 'none'`, scripts only via `nonce-…`, styles only via
 *    `webview.cspSource`; no remote content, no `unsafe-inline` scripts.
 *  - local resources loaded exclusively through `asWebviewUri` with
 *    `localResourceRoots` pinned to the extension `media/` dir.
 *  - one-directional data: the host streams a fully-simplified {@link TranscriptView};
 *    the webview only renders and, on load, sends a single `ready`.
 *  - `retainContextWhenHidden: false`; the webview restores via a `ready`-driven
 *    re-push and its own `getState`/`setState`.
 */
export class TranscriptPanel {
  private panel: vscode.WebviewPanel | undefined;
  /** Extension-tracked source of what's shown, re-read on `ready`. */
  private current: { filePath: string; title: string } | undefined;

  constructor(private readonly mediaUri: vscode.Uri) {}

  /** Open (or refocus) the panel on a transcript file and push its turns. */
  async open(source: { filePath: string; title: string }): Promise<void> {
    this.current = source;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "intelligents.transcript",
        "Transcript",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: false,
          localResourceRoots: [this.mediaUri],
        },
      );
      this.panel.webview.html = this.html(this.panel.webview);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw));
    }

    this.panel.title = source.title || "Transcript";
    this.panel.reveal(vscode.ViewColumn.Active);
    await this.push();
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isReadyMessage(raw)) {
      console.warn("intelligents: dropped invalid transcript message", raw);
      return;
    }
    // Webview (re)loaded — re-stream and push the authoritative state.
    await this.push();
  }

  private async push(): Promise<void> {
    if (!this.current) {
      return;
    }
    const data = await loadTranscript(
      this.current.filePath,
      this.current.title,
    );
    this.post({ type: "transcript", data });
  }

  private post(message: TranscriptHostMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "transcript.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "transcript.css"),
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
	<title>Transcript</title>
</head>
<body>
	<main id="root"></main>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
