import * as vscode from "vscode";
import {
  LiveSession,
  addWorktree,
  branchFor,
  deleteBranch,
  deriveSlug,
  gitErrorMessage,
  listWorktreePaths,
  reconcileRecords,
  removeWorktree,
  validateTaskName,
  worktreePathFor,
} from "./liveSessionStore";

/**
 * Extension-host wiring for the worktree-per-session lifecycle. Owns the mutable
 * session state (persisted in `workspaceState`), the slug -> terminal map, and
 * all `vscode.*` interactions (input box, terminals, modals). Pure git/record
 * logic lives in {@link file://./liveSessionStore.ts}.
 *
 * Every mutation persists then calls {@link onChange} so the tree repaints.
 */

const STATE_KEY = "intelligents.liveSessions";

/** Read-only view the tree provider queries; keeps the provider decoupled. */
export interface LiveSessionQuery {
  /** Sessions for one agent, newest first. */
  getForAgent(agentName: string): LiveSession[];
}

export class LiveSessionManager implements LiveSessionQuery {
  private records: LiveSession[];
  /** Live terminals keyed by session slug. Absent = terminal closed/never opened. */
  private readonly terminals = new Map<string, vscode.Terminal>();

  constructor(
    private readonly repoRoot: string,
    private readonly context: vscode.ExtensionContext,
    private readonly onChange: () => void,
    /**
     * Notified with the full record set after every mutation/reconciliation so
     * the status monitor can start/stop its per-session transcript watchers.
     * Invoked only on later mutations (never during construction), so callers
     * may safely close over a monitor constructed after this manager.
     */
    private readonly onSessionsChanged: (
      sessions: readonly LiveSession[],
    ) => void = () => {},
  ) {
    this.records = context.workspaceState.get<LiveSession[]>(STATE_KEY, []);
    // Drop our terminal handle when the user closes it so reveal relaunches.
    context.subscriptions.push(
      vscode.window.onDidCloseTerminal((closed) => {
        for (const [slug, terminal] of this.terminals) {
          if (terminal === closed) {
            this.terminals.delete(slug);
          }
        }
      }),
    );
  }

  getForAgent(agentName: string): LiveSession[] {
    return this.records
      .filter((r) => r.agentName === agentName)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** All live-session records (any agent). Used to seed the status monitor. */
  allSessions(): readonly LiveSession[] {
    return this.records;
  }

  /**
   * Reconcile persisted records against `git worktree list` and drop any whose
   * worktree vanished (removed outside the extension). Silent on git failure —
   * reconciliation is best-effort enrichment, not a hard gate.
   */
  async reconcile(): Promise<void> {
    let paths: string[];
    try {
      paths = await listWorktreePaths(this.repoRoot);
    } catch {
      return;
    }
    const kept = reconcileRecords(this.records, paths);
    if (kept.length !== this.records.length) {
      this.records = kept;
      await this.persist();
      this.onSessionsChanged(this.records);
      this.onChange();
    }
  }

  /**
   * New Session flow: prompt for a task name, create the worktree + branch,
   * launch the agent in a dedicated terminal, and record the session.
   */
  async newSession(agentName: string): Promise<void> {
    const taskName = await vscode.window.showInputBox({
      title: `New Session — ${agentName}`,
      prompt: "Short task name (becomes the worktree slug and branch)",
      placeHolder: "e.g. add search API",
      validateInput: (value) => validateTaskName(value),
    });
    if (taskName === undefined) {
      return; // cancelled
    }

    const slug = deriveSlug(taskName);
    if (this.records.some((r) => r.slug === slug)) {
      void vscode.window.showErrorMessage(
        `A live session with slug "${slug}" already exists. Pick a different task name.`,
      );
      return;
    }

    const branch = branchFor(agentName, slug);
    const worktreePath = worktreePathFor(this.repoRoot, slug);
    try {
      await addWorktree(this.repoRoot, worktreePath, branch);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `git worktree add failed: ${gitErrorMessage(err)}`,
      );
      return;
    }

    const session: LiveSession = {
      slug,
      agentName,
      branch,
      worktreePath,
      createdAt: Date.now(),
    };
    this.records = [session, ...this.records];
    await this.persist();
    this.onSessionsChanged(this.records);
    this.launchTerminal(session, `claude --agent ${agentName}`);
    this.onChange();
  }

  /**
   * Reveal a session: focus its terminal if still open, otherwise relaunch
   * `claude --continue` in a fresh terminal at the worktree.
   */
  reveal(session: LiveSession): void {
    const existing = this.terminals.get(session.slug);
    if (existing) {
      existing.show();
      return;
    }
    this.launchTerminal(session, "claude --continue");
  }

  /**
   * Archive a session: modal-confirm, dispose the terminal, `git worktree
   * remove` (with a second explicit confirmation before `--force` on failure),
   * then `git branch -d` (kept, not force-deleted, if unmerged). Persists and
   * repaints only after the worktree is actually gone.
   */
  async archive(session: LiveSession): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Archive session "${session.slug}"?\n\nThis removes the worktree at ${session.worktreePath} and deletes branch "${session.branch}". This cannot be undone.`,
      { modal: true },
      "Archive",
    );
    if (confirm !== "Archive") {
      return;
    }

    const terminal = this.terminals.get(session.slug);
    if (terminal) {
      terminal.dispose();
      this.terminals.delete(session.slug);
    }

    if (!(await this.removeWorktreeInteractive(session))) {
      return; // aborted or failed — record kept
    }

    try {
      await deleteBranch(this.repoRoot, session.branch);
    } catch (err) {
      void vscode.window.showWarningMessage(
        `Worktree removed, but branch "${session.branch}" was kept because it is not fully merged: ${gitErrorMessage(err)}`,
      );
    }

    this.records = this.records.filter((r) => r.slug !== session.slug);
    await this.persist();
    this.onSessionsChanged(this.records);
    this.onChange();
  }

  /**
   * Remove the worktree, escalating to `--force` only after a second explicit
   * modal confirmation. Returns true when the worktree is gone.
   */
  private async removeWorktreeInteractive(
    session: LiveSession,
  ): Promise<boolean> {
    try {
      await removeWorktree(this.repoRoot, session.worktreePath, false);
      return true;
    } catch (err) {
      const force = await vscode.window.showWarningMessage(
        `git worktree remove failed: ${gitErrorMessage(err)}\n\nForce-remove the worktree? Any uncommitted changes in it will be lost.`,
        { modal: true },
        "Force Remove",
      );
      if (force !== "Force Remove") {
        return false;
      }
      try {
        await removeWorktree(this.repoRoot, session.worktreePath, true);
        return true;
      } catch (err2) {
        void vscode.window.showErrorMessage(
          `git worktree remove --force failed: ${gitErrorMessage(err2)}`,
        );
        return false;
      }
    }
  }

  /** Create, track, show, and run a command in a session terminal. */
  private launchTerminal(session: LiveSession, command: string): void {
    const terminal = vscode.window.createTerminal({
      name: `${session.agentName}: ${session.slug}`,
      cwd: session.worktreePath,
    });
    this.terminals.set(session.slug, terminal);
    terminal.show();
    terminal.sendText(command);
  }

  private persist(): Thenable<void> {
    return this.context.workspaceState.update(STATE_KEY, this.records);
  }
}
