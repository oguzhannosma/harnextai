import * as vscode from "vscode";
import type { LiveSession } from "./liveSessionStore";
import type { SessionStatusQuery } from "./sessionStatusMonitor";

/**
 * A status-bar summary of live agent sessions. Driven by the SAME events that
 * repaint the tree: {@link LiveSessionManager}'s `onSessionsChanged` (records
 * added/removed) and {@link SessionStatusMonitor}'s debounced reclassification
 * (a badge flipped). Both call {@link refresh}.
 *
 * Presentation (task spec):
 *  - `$(robot) N working` — N = live sessions currently `working`.
 *  - `$(robot) N idle`    — when none are working but sessions exist; N = live count.
 *  - hidden entirely when there are no live sessions.
 *  - click focuses the sidebar view; tooltip is one line per live session.
 */

/** Minimal read-only view of the live-session set the status bar summarizes. */
export interface LiveSessionsSnapshot {
  allSessions(): readonly LiveSession[];
}

/** Pure computation of the item's presentation — split out for testability. */
export function statusBarState(
  sessions: readonly LiveSession[],
  getStatus: (slug: string) => string,
): { visible: false } | { visible: true; text: string; tooltip: string } {
  if (sessions.length === 0) {
    return { visible: false };
  }
  const working = sessions.filter(
    (s) => getStatus(s.slug) === "working",
  ).length;
  const text =
    working > 0
      ? `$(robot) ${working} working`
      : `$(robot) ${sessions.length} idle`;
  const tooltip = sessions
    .map((s) => `${s.agentName}: ${s.slug} — ${getStatus(s.slug)}`)
    .join("\n");
  return { visible: true, text, tooltip };
}

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor(
    private readonly sessions: LiveSessionsSnapshot,
    private readonly status: SessionStatusQuery,
  ) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    // Built-in "<viewId>.focus" command reveals the sidebar view.
    this.item.command = "intelligents.agentsView.focus";
  }

  /** Recompute from the current live sessions and their statuses, then show/hide. */
  refresh(): void {
    const state = statusBarState(this.sessions.allSessions(), (slug) =>
      this.status.getStatus(slug),
    );
    if (!state.visible) {
      this.item.hide();
      return;
    }
    this.item.text = state.text;
    this.item.tooltip = state.tooltip;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
