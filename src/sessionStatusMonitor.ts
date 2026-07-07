import * as vscode from "vscode";
import * as path from "node:path";
import { LiveSession } from "./liveSessionStore";
import { sanitizeCwd } from "./sessionStore";
import {
  SessionStatus,
  classifySession,
  findActiveTranscript,
} from "./sessionStatus";

/**
 * Extension-host layer that keeps a live status badge for each session in sync
 * with its Claude Code transcript. Owns one {@link vscode.FileSystemWatcher} per
 * session (watching that session's `~/.claude/projects/<sanitized-worktree>/*.jsonl`),
 * debounces the many rapid transcript appends, re-runs the pure
 * {@link classifySession} on change, repaints the tree when a session's state
 * flips, and fires a rate-limited warning when a session transitions into
 * `'blocked'`. All classification logic is pure and lives in
 * {@link file://./sessionStatus.ts}; this module is only wiring.
 *
 * Best-effort by design (research doc §4/§5.4): the transcript format is
 * undocumented and may drift, so an unresolved dir or unparseable tail simply
 * leaves the session at `'unknown'` (no badge) rather than erroring.
 */

/** Read-only view the tree provider queries for a session's badge. */
export interface SessionStatusQuery {
  /** Current status for a session slug; `'unknown'` when never classified. */
  getStatus(slug: string): SessionStatus;
}

/** Debounce window for transcript appends (they arrive in bursts). */
const DEBOUNCE_MS = 500;
/** Minimum spacing between blocked notifications for the same session. */
const BLOCKED_NOTIFY_COOLDOWN_MS = 60_000;

interface Watched {
  readonly session: LiveSession;
  readonly watcher: vscode.FileSystemWatcher;
  status: SessionStatus;
  debounce?: ReturnType<typeof setTimeout>;
  lastBlockedNotifyAt: number;
}

export class SessionStatusMonitor implements SessionStatusQuery {
  private readonly watched = new Map<string, Watched>();

  constructor(
    private readonly homeDir: string,
    /** Repaint the tree (a session's badge changed). */
    private readonly onChange: () => void,
    /** Reveal a session's terminal (the blocked-notification button). */
    private readonly reveal: (session: LiveSession) => void,
  ) {}

  getStatus(slug: string): SessionStatus {
    return this.watched.get(slug)?.status ?? "unknown";
  }

  /**
   * Reconcile the set of watched sessions against {@link sessions}: start a
   * watcher (and an immediate classification) for any new slug, dispose the
   * watcher for any slug no longer present. Idempotent — safe to call after
   * every session mutation and reconciliation.
   */
  syncSessions(sessions: readonly LiveSession[]): void {
    const wanted = new Set(sessions.map((s) => s.slug));
    for (const [slug, entry] of this.watched) {
      if (!wanted.has(slug)) {
        this.disposeEntry(entry);
        this.watched.delete(slug);
      }
    }
    for (const session of sessions) {
      if (!this.watched.has(session.slug)) {
        this.startWatching(session);
      }
    }
  }

  /** Dispose every watcher and pending timer. Registered in `context.subscriptions`. */
  dispose(): void {
    for (const entry of this.watched.values()) {
      this.disposeEntry(entry);
    }
    this.watched.clear();
  }

  private startWatching(session: LiveSession): void {
    // Watch from the stable `projects` root with a per-session subdir pattern:
    // the session's own project dir may not exist until `claude` first writes,
    // and `projects/` reliably does, so the watcher still fires on first append.
    const projectsRoot = path.join(this.homeDir, ".claude", "projects");
    const subdir = sanitizeCwd(session.worktreePath);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(projectsRoot),
        `${subdir}/*.jsonl`,
      ),
    );
    const entry: Watched = {
      session,
      watcher,
      status: "unknown",
      lastBlockedNotifyAt: 0,
    };
    this.watched.set(session.slug, entry);

    const onEvent = () => this.scheduleReclassify(session.slug);
    watcher.onDidCreate(onEvent);
    watcher.onDidChange(onEvent);
    watcher.onDidDelete(onEvent);

    // Seed the badge from whatever is already on disk (resumed sessions).
    this.scheduleReclassify(session.slug);
  }

  private scheduleReclassify(slug: string): void {
    const entry = this.watched.get(slug);
    if (!entry) {
      return;
    }
    if (entry.debounce) {
      clearTimeout(entry.debounce);
    }
    entry.debounce = setTimeout(() => {
      entry.debounce = undefined;
      void this.reclassify(slug);
    }, DEBOUNCE_MS);
  }

  private async reclassify(slug: string): Promise<void> {
    const entry = this.watched.get(slug);
    if (!entry) {
      return; // disposed while debouncing
    }
    let status: SessionStatus;
    try {
      const transcript = await findActiveTranscript(
        this.homeDir,
        entry.session.worktreePath,
      );
      status = transcript ? await classifySession(transcript) : "unknown";
    } catch {
      status = "unknown";
    }

    // The entry may have been disposed during the awaits.
    const current = this.watched.get(slug);
    if (!current || current !== entry) {
      return;
    }
    if (status === entry.status) {
      return;
    }
    const previous = entry.status;
    entry.status = status;
    this.onChange();
    if (status === "blocked" && previous !== "blocked") {
      this.notifyBlocked(entry);
    }
  }

  private notifyBlocked(entry: Watched): void {
    const now = Date.now();
    if (now - entry.lastBlockedNotifyAt < BLOCKED_NOTIFY_COOLDOWN_MS) {
      return;
    }
    entry.lastBlockedNotifyAt = now;
    const { session } = entry;
    void vscode.window
      .showWarningMessage(
        `${session.agentName}: ${session.slug} is waiting for input`,
        "Open Terminal",
      )
      .then((choice) => {
        if (choice === "Open Terminal") {
          this.reveal(session);
        }
      });
  }

  private disposeEntry(entry: Watched): void {
    if (entry.debounce) {
      clearTimeout(entry.debounce);
      entry.debounce = undefined;
    }
    entry.watcher.dispose();
  }
}
