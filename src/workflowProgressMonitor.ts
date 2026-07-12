import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { LiveSession } from "./liveSessionStore";
import {
  WorkflowProgressHighlight,
  parseWorkflowProgress,
} from "./workflowProgress";

/**
 * Watches `progress.md` in each active issue workflow worktree and exposes the
 * most recently updated highlight for the Workflow graph webview. Uses FS
 * watchers plus a 1s poll fallback so early creates are not missed.
 */

const PROGRESS_FILE = "progress.md";
const POLL_MS = 1000;

interface Watched {
  readonly session: LiveSession;
  readonly watcher: vscode.FileSystemWatcher;
  highlight: WorkflowProgressHighlight | undefined;
  updatedAtMs: number;
  lastFingerprint: string;
}

export interface WorkflowProgressQuery {
  /** Best highlight among watched issue sessions, or undefined. */
  getHighlight(): WorkflowProgressHighlight | undefined;
  /** Highlight for one issue worktree slug (`issue-21`), if known. */
  getHighlightForSlug(slug: string): WorkflowProgressHighlight | undefined;
  /** Highlight for a GitHub issue number among watched sessions. */
  getHighlightForIssue(issue: number): WorkflowProgressHighlight | undefined;
}

export class WorkflowProgressMonitor implements WorkflowProgressQuery {
  private readonly watched = new Map<string, Watched>();
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly onChange: () => void) {}

  getHighlight(): WorkflowProgressHighlight | undefined {
    let best: WorkflowProgressHighlight | undefined;
    let bestMs = -Infinity;
    for (const entry of this.watched.values()) {
      if (!entry.highlight) {
        continue;
      }
      if (entry.updatedAtMs > bestMs) {
        bestMs = entry.updatedAtMs;
        best = entry.highlight;
      }
    }
    return best;
  }

  getHighlightForSlug(slug: string): WorkflowProgressHighlight | undefined {
    return this.watched.get(slug)?.highlight;
  }

  getHighlightForIssue(issue: number): WorkflowProgressHighlight | undefined {
    let best: WorkflowProgressHighlight | undefined;
    let bestMs = -Infinity;
    for (const entry of this.watched.values()) {
      if (!entry.highlight || entry.highlight.issue !== issue) {
        continue;
      }
      if (entry.updatedAtMs > bestMs) {
        bestMs = entry.updatedAtMs;
        best = entry.highlight;
      }
    }
    return best;
  }

  /** Force re-read progress for one issue session (e.g. right after seeding). */
  reloadSlug(slug: string): void {
    const entry = this.watched.get(slug);
    if (entry) {
      void this.reload(entry);
    }
  }

  syncSessions(sessions: readonly LiveSession[]): void {
    const wanted = new Set(
      sessions
        .filter((s) => !s.archived && s.slug.startsWith("issue-"))
        .map((s) => s.slug),
    );
    for (const [slug, entry] of this.watched) {
      if (!wanted.has(slug)) {
        entry.watcher.dispose();
        this.watched.delete(slug);
      }
    }
    for (const session of sessions) {
      if (session.archived || !session.slug.startsWith("issue-")) {
        continue;
      }
      if (!this.watched.has(session.slug)) {
        this.startWatching(session);
      }
    }
    this.updatePoll();
    this.onChange();
  }

  dispose(): void {
    this.stopPoll();
    for (const entry of this.watched.values()) {
      entry.watcher.dispose();
    }
    this.watched.clear();
  }

  private startWatching(session: LiveSession): void {
    const filePattern = new vscode.RelativePattern(
      vscode.Uri.file(session.worktreePath),
      PROGRESS_FILE,
    );
    const watcher = vscode.workspace.createFileSystemWatcher(filePattern);
    const entry: Watched = {
      session,
      watcher,
      highlight: undefined,
      updatedAtMs: 0,
      lastFingerprint: "",
    };
    const schedule = () => void this.reload(entry);
    watcher.onDidCreate(schedule);
    watcher.onDidChange(schedule);
    watcher.onDidDelete(() => {
      entry.highlight = undefined;
      entry.updatedAtMs = 0;
      this.notifyIfChanged(entry, "");
    });
    this.watched.set(session.slug, entry);
    void this.reload(entry);
  }

  private async reload(entry: Watched): Promise<void> {
    const filePath = path.join(entry.session.worktreePath, PROGRESS_FILE);
    let text: string;
    try {
      text = await fs.readFile(filePath, "utf8");
    } catch {
      this.notifyIfChanged(entry, "");
      entry.highlight = undefined;
      entry.updatedAtMs = 0;
      return;
    }
    const parsed = parseWorkflowProgress(text);
    if (!parsed.ok) {
      this.notifyIfChanged(entry, "");
      entry.highlight = undefined;
      entry.updatedAtMs = 0;
      return;
    }
    const { progress } = parsed;
    entry.highlight = {
      activeStepIndex: progress.stepIndex,
      status: progress.status,
      issue: progress.issue,
      step: progress.step,
      updatedAt: progress.updatedAt,
      note: progress.note,
    };
    entry.updatedAtMs = parseUpdatedAt(progress.updatedAt);
    this.notifyIfChanged(entry, fingerprint(entry.highlight));
  }

  private notifyIfChanged(entry: Watched, next: string): void {
    if (entry.lastFingerprint === next) {
      return;
    }
    entry.lastFingerprint = next;
    this.onChange();
  }

  private updatePoll(): void {
    if (this.watched.size === 0) {
      this.stopPoll();
      return;
    }
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      for (const entry of this.watched.values()) {
        void this.reload(entry);
      }
    }, POLL_MS);
  }

  private stopPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
}

function fingerprint(h: WorkflowProgressHighlight | undefined): string {
  if (!h) {
    return "";
  }
  return `${h.issue}|${h.activeStepIndex}|${h.status}|${h.step}|${h.updatedAt}`;
}

function parseUpdatedAt(iso: string): number {
  if (!iso) {
    return Date.now();
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Date.now();
}
