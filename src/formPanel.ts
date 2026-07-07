import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { readAgentForm, writeAgentForm } from "./agentStore";
import { readSkillForm, writeSkillForm } from "./skillStore";
import { readMemoryForm, writeMemoryForm } from "./memoryStore";
import {
  FormData,
  HostMessage,
  isWebviewMessage,
  AgentFormData,
  SkillFormData,
  MemoryFormData,
} from "./shared/messages";
import type { OpenFormArg } from "./agentTree";

/**
 * Owns the single reusable webview panel that renders the structured
 * agent/skill/memory editor. One panel is reused across all items (per the
 * `webview-ui` skill's state model): opening a different item pushes fresh
 * state rather than spawning panels.
 *
 * Security posture (webview-ui skill, verified against its checklist):
 *  - strict CSP `default-src 'none'`, scripts only via `nonce-…`, styles/fonts
 *    only via `webview.cspSource`; no remote content, no `unsafe-inline` scripts.
 *  - local resources loaded exclusively through `asWebviewUri` with
 *    `localResourceRoots` pinned to the extension `media/` dir.
 *  - every inbound message validated with the shared `isWebviewMessage`; the
 *    extension owns all disk writes — the webview only renders and requests.
 *  - `retainContextWhenHidden: false`; the webview restores via a `ready`-driven
 *    full-state push.
 */
export class FormPanel {
  private panel: vscode.WebviewPanel | undefined;
  /** Extension-tracked source of truth for what's being edited. The webview's
   * own `filePath` is never trusted for writes — we use this. */
  private current: OpenFormArg | undefined;

  constructor(
    private readonly mediaUri: vscode.Uri,
    private readonly onSaved: () => void,
  ) {}

  /** Open (or refocus) the panel on the given tree item and push its state. */
  async open(arg: OpenFormArg): Promise<void> {
    this.current = arg;
    let data: FormData;
    try {
      data = await this.readForm(arg);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Could not open ${arg.filePath}: ${errMessage(err)}`,
      );
      return;
    }

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "intelligents.form",
        "Intelligents",
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

    this.panel.title = titleFor(data);
    this.panel.reveal(vscode.ViewColumn.Active);
    this.post({ type: "state", data });
  }

  private async readForm(arg: OpenFormArg): Promise<FormData> {
    switch (arg.kind) {
      case "agent":
        return readAgentForm(arg.filePath);
      case "skill":
        return readSkillForm(arg.filePath);
      case "memory":
        return readMemoryForm(arg.filePath, defaultBudgetFor(arg.filePath));
    }
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isWebviewMessage(raw)) {
      console.warn("intelligents: dropped invalid webview message", raw);
      return;
    }
    if (raw.type === "ready") {
      // Webview (re)loaded — re-push current state.
      if (this.current) {
        try {
          this.post({ type: "state", data: await this.readForm(this.current) });
        } catch {
          /* file vanished — leave the webview on its cached state */
        }
      }
      return;
    }
    // raw.type === 'save'
    if (!this.current) {
      return;
    }
    // Trust only the extension-tracked path/kind, never the webview's.
    const target = this.current;
    if (raw.data.kind !== target.kind) {
      this.post({
        type: "error",
        message: "Editor kind mismatch; not saving.",
      });
      return;
    }
    try {
      await this.write(target, raw.data);
      this.post({ type: "saved" });
      this.onSaved();
    } catch (err) {
      this.post({ type: "error", message: errMessage(err) });
    }
  }

  private async write(target: OpenFormArg, data: FormData): Promise<void> {
    switch (target.kind) {
      case "agent":
        return writeAgentForm(target.filePath, data as AgentFormData);
      case "skill":
        return writeSkillForm(target.filePath, data as SkillFormData);
      case "memory":
        return writeMemoryForm(target.filePath, data as MemoryFormData);
    }
  }

  private post(message: HostMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "formPanel.css"),
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
	<title>Intelligents</title>
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

function titleFor(data: FormData): string {
  switch (data.kind) {
    case "agent":
      return `Agent: ${data.name || "untitled"}`;
    case "skill":
      return `Skill: ${data.name || "untitled"}`;
    case "memory":
      return `Memory: ${data.label}`;
  }
}

function defaultBudgetFor(filePath: string): number {
  return /team-memories/i.test(filePath) ? 4000 : 2200;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
