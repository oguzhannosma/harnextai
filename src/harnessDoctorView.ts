import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { hasHarness } from "./harness/project";
import { runDoctorChecks, applyDoctorFixes } from "./harness/doctor";
import {
  HarnessDoctorHostMessage,
  HarnessDoctorView,
  isHarnessDoctorWebviewMessage,
} from "./shared/messages";

const VIEW_TYPE = "harnextai.harnessDoctorView";

export interface HarnessDoctorActions {
  /** Invoked when the webview asks to initialize a harness (opens picker + architect). */
  readonly onBootstrapRequest: () => void | PromiseLike<void>;
  readonly onFixed?: () => void;
}

/**
 * Sidebar webview: harness health checks with Fix all / Refresh / Bootstrap.
 */
export class HarnessDoctorViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private lastFixActions: string[] | undefined;

  constructor(
    private readonly mediaUri: vscode.Uri,
    private readonly repoRoot: string,
    private readonly actions: HarnessDoctorActions,
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

  /** Run doctor fixes and refresh the view + trees. */
  async fixAll(): Promise<string[]> {
    if (!hasHarness(this.repoRoot)) {
      return [];
    }
    const actions = await applyDoctorFixes(this.repoRoot);
    this.lastFixActions = actions;
    this.actions.onFixed?.();
    await this.push();
    return actions;
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!isHarnessDoctorWebviewMessage(raw)) {
      console.warn("harnextai: dropped invalid doctor message", raw);
      return;
    }
    if (raw.type === "ready" || raw.type === "refreshDoctor") {
      await this.push();
      return;
    }
    if (raw.type === "bootstrapHarness") {
      await this.actions.onBootstrapRequest();
      await this.push();
      return;
    }
    if (raw.type === "fixAllDoctor") {
      const actions = await this.fixAll();
      if (actions.length > 0) {
        void vscode.window.showInformationMessage(
          `Doctor applied ${actions.length} fix${actions.length === 1 ? "" : "es"}.`,
        );
      }
    }
  }

  private async push(): Promise<void> {
    if (!this.view) {
      return;
    }
    const data = await this.loadView();
    this.post({ type: "doctor", data });
  }

  private async loadView(): Promise<HarnessDoctorView> {
    if (!hasHarness(this.repoRoot)) {
      return { hasHarness: false, findings: [] };
    }
    try {
      const findings = await runDoctorChecks(this.repoRoot);
      const view: HarnessDoctorView = {
        hasHarness: true,
        findings,
      };
      if (this.lastFixActions && this.lastFixActions.length > 0) {
        return { ...view, fixActions: this.lastFixActions };
      }
      return view;
    } catch (err) {
      return {
        hasHarness: true,
        findings: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private post(message: HarnessDoctorHostMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "doctor.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.mediaUri, "doctor.css"),
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
	<title>Doctor</title>
</head>
<body>
	<main id="root"></main>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export { VIEW_TYPE as HARNESS_DOCTOR_VIEW_ID };
