import * as vscode from "vscode";
import type { LiveSession } from "./liveSessionStore";
import type { SessionStatusQuery } from "./sessionStatusMonitor";
import type { WorkflowProgressQuery } from "./workflowProgressMonitor";

/**
 * A status-bar summary of live agent sessions. Driven by the SAME events that
 * repaint the tree: {@link LiveSessionManager}'s `onSessionsChanged` (records
 * added/removed) and {@link SessionStatusMonitor}'s debounced reclassification
 * (a badge flipped). Both call {@link refresh}.
 *
 * Presentation:
 *  - spinning robot when any session is working/active
 *  - `N working` / `N idle` otherwise
 *  - hidden when there are no live sessions
 *  - click focuses the Workflow view when any issue session is active
 */

export interface LiveSessionsSnapshot {
  allSessions(): readonly LiveSession[];
}

export function statusBarState(
  sessions: readonly LiveSession[],
  getStatus: (slug: string) => string,
):
  | { visible: false }
  | { visible: true; text: string; tooltip: string; busy: boolean } {
  if (sessions.length === 0) {
    return { visible: false };
  }
  const busy = sessions.some((s) => {
    const status = getStatus(s.slug);
    return status === "working" || status === "active";
  });
  const waiting = sessions.some((s) => getStatus(s.slug) === "waiting-user");
  const working = sessions.filter((s) => {
    const status = getStatus(s.slug);
    return status === "working" || status === "active";
  }).length;
  let text: string;
  if (waiting) {
    text = `$(warning) ${sessions.length} need you`;
  } else if (busy) {
    text = `$(sync~spin) ${working} working`;
  } else {
    text = `$(robot) ${sessions.length} idle`;
  }
  const tooltip = sessions
    .map((s) => `${s.agentName}: ${s.slug} — ${getStatus(s.slug)}`)
    .join("\n");
  return { visible: true, text, tooltip, busy };
}

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;
  private progress: WorkflowProgressQuery | undefined;
  private pulseTimer: ReturnType<typeof setInterval> | undefined;
  private pulseOn = false;

  constructor(
    private readonly sessions: LiveSessionsSnapshot,
    private readonly status: SessionStatusQuery,
  ) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.command = "harnextai.workflowView.focus";
  }

  setProgressQuery(progress: WorkflowProgressQuery): void {
    this.progress = progress;
  }

  refresh(): void {
    const state = statusBarState(this.sessions.allSessions(), (slug) =>
      this.resolveStatus(slug),
    );
    if (!state.visible) {
      this.stopPulse();
      this.item.hide();
      return;
    }
    this.item.text = state.text;
    this.item.tooltip = state.tooltip;
    this.item.backgroundColor = state.busy
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
    this.item.show();
    if (state.busy) {
      this.startPulse();
    } else {
      this.stopPulse();
    }
  }

  dispose(): void {
    this.stopPulse();
    this.item.dispose();
  }

  private resolveStatus(slug: string): string {
    if (slug.startsWith("issue-") && this.progress) {
      const highlight = this.progress.getHighlightForSlug(slug);
      if (highlight) {
        return highlight.status;
      }
    }
    return this.status.getStatus(slug);
  }

  /** Alternate accent while busy so the bar feels alive (VS Code has no CSS). */
  private startPulse(): void {
    if (this.pulseTimer) {
      return;
    }
    this.pulseTimer = setInterval(() => {
      this.pulseOn = !this.pulseOn;
      const state = statusBarState(this.sessions.allSessions(), (slug) =>
        this.resolveStatus(slug),
      );
      if (!state.visible || !state.busy) {
        this.stopPulse();
        this.refresh();
        return;
      }
      this.item.backgroundColor = this.pulseOn
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
    }, 1200);
  }

  private stopPulse(): void {
    if (this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = undefined;
    }
    this.pulseOn = false;
    this.item.backgroundColor = undefined;
  }
}
