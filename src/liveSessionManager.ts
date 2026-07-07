import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import {
  ChangedFile,
  LiveSession,
  abortMerge,
  addWorktree,
  branchExists,
  branchFor,
  currentBranch,
  deleteBranch,
  deriveSlug,
  diffNameStatus,
  forceDeleteBranch,
  gitErrorMessage,
  headShortSha,
  isMergeConflictError,
  isNotAWorkingTreeError,
  isUnderWorktreesDir,
  isUnmergedBranchError,
  isWorkingTreeClean,
  listWorktreePaths,
  mergeBase,
  mergeNoFf,
  pruneWorktrees,
  quotePromptArg,
  reconcileRecords,
  removeWorktree,
  repoHasCommits,
  showFileAtRef,
  validateTaskName,
  worktreePathFor,
} from "./liveSessionStore";
import * as path from "node:path";

/**
 * URI scheme for the left (base-revision) side of a review diff. A single
 * {@link vscode.TextDocumentContentProvider} resolves these by running
 * `git show <ref>:<path>`, so no temp files are written — the diff's left side is
 * a virtual read-only document. The right side is the live worktree file on disk
 * (a plain `file:` URI) so uncommitted changes show, per the Conductor-style
 * behavior the task calls for.
 */
const DIFF_SCHEME = "intelligents-diff";

/**
 * Extension-host wiring for the worktree-per-session lifecycle. Owns the mutable
 * session state (persisted in `workspaceState`), the slug -> terminal map, and
 * all `vscode.*` interactions (input box, terminals, modals). Pure git/record
 * logic lives in {@link file://./liveSessionStore.ts}.
 *
 * Every mutation persists then calls {@link onChange} so the tree repaints.
 */

const STATE_KEY = "intelligents.liveSessions";

/** Human word for a `git diff --name-status` status letter (QuickPick hint). */
function describeStatus(status: string): string {
  switch (status) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type changed";
    default:
      return status;
  }
}

/** Read-only view the tree provider queries; keeps the provider decoupled. */
export interface LiveSessionQuery {
  /** Live (non-archived) sessions for one agent, newest first. */
  getForAgent(agentName: string): LiveSession[];
  /** All archived sessions across every agent, newest first. */
  getArchived(): LiveSession[];
  /** True when any archived session exists (drives the "Archived" group). */
  hasArchived(): boolean;
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
    // One registration for the review-diff left side (base-revision content).
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, {
        provideTextDocumentContent: (uri) => {
          const q = new URLSearchParams(uri.query);
          const repo = q.get("repo");
          const ref = q.get("ref");
          const file = q.get("path");
          if (!repo || !ref || !file) {
            return "";
          }
          return showFileAtRef(repo, ref, file);
        },
      }),
    );
  }

  getForAgent(agentName: string): LiveSession[] {
    return this.records
      .filter((r) => r.agentName === agentName && !r.archived)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getArchived(): LiveSession[] {
    return this.records
      .filter((r) => r.archived)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  hasArchived(): boolean {
    return this.records.some((r) => r.archived);
  }

  /**
   * Live-session records only (any agent). Seeds the status monitor — archived
   * sessions have no worktree left to watch, so they are excluded.
   */
  allSessions(): readonly LiveSession[] {
    return this.records.filter((r) => !r.archived);
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
    // Only live records are backed by a worktree; archived records intentionally
    // have none, so they are exempt from the worktree-existence reconciliation
    // and always kept.
    const archived = this.records.filter((r) => r.archived);
    const live = this.records.filter((r) => !r.archived);
    const keptLive = reconcileRecords(live, paths);
    if (keptLive.length !== live.length) {
      this.records = [...keptLive, ...archived];
      await this.persist();
      this.onSessionsChanged(this.records);
      this.onChange();
    }
  }

  /**
   * New Session flow: guard against an unborn HEAD, prompt for a short task name
   * (slug/branch source) and an optional fuller description (the launch prompt),
   * create the worktree + branch, launch the agent with the prompt in a dedicated
   * terminal, and record the session.
   */
  async newSession(agentName: string): Promise<void> {
    // Unborn-HEAD guard: `git worktree add -b` on a commitless repo silently
    // infers `--orphan` and produces a bogus, un-removable worktree. Refuse up
    // front so git is never allowed to make that inference.
    if (!(await repoHasCommits(this.repoRoot))) {
      void vscode.window.showErrorMessage(
        "This repository has no commits yet — make an initial commit before creating agent sessions.",
      );
      return;
    }

    const taskName = await vscode.window.showInputBox({
      title: `New Session — ${agentName}`,
      prompt: "Short task name (becomes the worktree slug and branch)",
      placeHolder: "e.g. add search API",
      validateInput: (value) => validateTaskName(value),
      ignoreFocusOut: true,
    });
    if (taskName === undefined) {
      return; // cancelled
    }

    // Optional fuller description. This is where the whole sentence the user
    // might otherwise cram into the task name belongs — it becomes the agent's
    // opening prompt while the slug/branch stay short. Single-line by design
    // (`showInputBox` limitation, acceptable per task); Enter with no text skips.
    const description = await vscode.window.showInputBox({
      title: `New Session — ${agentName}`,
      prompt:
        "Task description sent to the agent as its first prompt (optional)",
      placeHolder: "Press Enter to skip and just start the agent",
      ignoreFocusOut: true,
    });
    if (description === undefined) {
      return; // cancelled at the second step
    }

    const slug = deriveSlug(taskName);
    if (this.records.some((r) => r.slug === slug)) {
      void vscode.window.showErrorMessage(
        `A session with slug "${slug}" already exists. Pick a different task name.`,
      );
      return;
    }

    const branch = branchFor(agentName, slug);
    const worktreePath = worktreePathFor(this.repoRoot, slug);
    // Record the base (repo's current HEAD branch) before creating the worktree,
    // so the review loop later diffs/merges against where the branch forked from.
    // Best-effort: a detached HEAD leaves it undefined and review falls back.
    let baseBranch: string | undefined;
    try {
      baseBranch = await currentBranch(this.repoRoot);
    } catch {
      baseBranch = undefined;
    }
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
      baseBranch,
    };
    this.records = [session, ...this.records];
    await this.persist();
    this.onSessionsChanged(this.records);

    // Prompt = the full description if given, else the (short) task name. Quoted
    // as a single argument that survives whatever shell the terminal runs.
    const promptText = description.trim() || taskName.trim();
    const command = `claude --agent ${agentName} ${quotePromptArg(promptText)}`;
    this.launchTerminal(session, command);
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
   * Archive a session: modal-confirm, dispose the terminal, remove the worktree
   * (with force / broken-worktree fallbacks), then KEEP the branch and flip the
   * record to `archived: true` so the user can find that branch later. Persists
   * and repaints only after the worktree is actually gone.
   */
  async archive(session: LiveSession): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Archive session "${session.slug}"?\n\nThis removes the worktree at ${session.worktreePath} but keeps branch "${session.branch}" so you can return to the work. The session moves to Archived.`,
      { modal: true },
      "Archive",
    );
    if (confirm !== "Archive") {
      return;
    }
    await this.archiveWithoutConfirm(session);
  }

  /**
   * Archive mechanics without the confirmation modal: dispose the terminal,
   * remove the worktree (KEEPING the branch), and flip the record to archived.
   * Shared by {@link archive} (after its own modal) and {@link mergeSession}
   * (after the merge succeeds — the merge modal already covered the archive).
   * Returns true when the record was archived; false if worktree removal was
   * aborted/failed (which surfaces its own message and leaves the record live).
   */
  private async archiveWithoutConfirm(session: LiveSession): Promise<boolean> {
    this.disposeTerminal(session.slug);

    if (!(await this.ensureWorktreeGone(session))) {
      return false; // aborted or failed — record kept as live
    }

    this.records = this.records.map((r) =>
      r.slug === session.slug ? { ...r, archived: true } : r,
    );
    await this.persist();
    this.onSessionsChanged(this.records);
    this.onChange();
    return true;
  }

  /**
   * Diff review (`intelligents.reviewSession`): show what the session's branch
   * changed relative to its base, using VS Code's native diff rather than a
   * custom viewer. Computes the merge-base of base↔branch in the MAIN repo (both
   * branches are visible there), lists changed files in a QuickPick, and opens
   * the picked file as a diff: left = the file at the merge-base (virtual, via
   * the {@link DIFF_SCHEME} provider), right = the live worktree file on disk so
   * uncommitted changes are visible too.
   */
  async reviewSession(session: LiveSession): Promise<void> {
    const base = session.baseBranch ?? (await this.resolveBaseBranch());
    if (!(await branchExists(this.repoRoot, session.branch))) {
      void vscode.window.showErrorMessage(
        `Session branch "${session.branch}" no longer exists — nothing to review.`,
      );
      return;
    }
    if (!(await branchExists(this.repoRoot, base))) {
      void vscode.window.showErrorMessage(
        `Base branch "${base}" does not exist — cannot compute what the session changed.`,
      );
      return;
    }

    let mergeBaseSha: string;
    let changes: ChangedFile[];
    try {
      mergeBaseSha = await mergeBase(this.repoRoot, base, session.branch);
      changes = await diffNameStatus(
        this.repoRoot,
        mergeBaseSha,
        session.branch,
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to compute the session diff: ${gitErrorMessage(err)}`,
      );
      return;
    }

    if (changes.length === 0) {
      void vscode.window.showInformationMessage(
        `Session "${session.slug}" has no committed changes relative to "${base}".`,
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(
      changes.map((file) => ({
        label: `${file.status} ${file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}`,
        description: describeStatus(file.status),
        file,
      })),
      {
        title: `Review "${session.slug}" — ${changes.length} changed file(s) vs ${base}`,
        placeHolder: "Pick a file to open its diff",
      },
    );
    if (!picked) {
      return;
    }
    await this.openFileDiff(session, base, mergeBaseSha, picked.file);
  }

  /**
   * Open one changed file as a native diff. Left is always the merge-base
   * revision resolved by the content provider (absent there → empty, which is
   * correct for an added file and for a rename's destination). Right is the live
   * worktree file for anything that still exists, or an empty virtual document
   * for a deleted file (the branch-side content is absent → empty).
   */
  private async openFileDiff(
    session: LiveSession,
    base: string,
    mergeBaseSha: string,
    file: ChangedFile,
  ): Promise<void> {
    const deleted = file.status === "D";
    // Left = base revision of the file (its old path for renames).
    const left = this.diffUri(mergeBaseSha, file.oldPath ?? file.path);
    // Right = live worktree file, unless deleted (show empty via the branch ref,
    // where the path is absent → the provider yields '').
    const right = deleted
      ? this.diffUri(session.branch, file.path)
      : vscode.Uri.file(path.join(session.worktreePath, file.path));
    const title = `${file.path} (${base} ↔ ${session.slug})`;
    await vscode.commands.executeCommand("vscode.diff", left, right, title);
  }

  /** Build a left/virtual diff URI resolved by the {@link DIFF_SCHEME} provider. */
  private diffUri(ref: string, filePath: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: DIFF_SCHEME,
      // Path drives the editor's displayed filename; params ride in the query.
      path: `/${filePath}`,
      query: new URLSearchParams({
        repo: this.repoRoot,
        ref,
        path: filePath,
      }).toString(),
    });
  }

  /**
   * Merge & Archive (`intelligents.mergeSession`): one-click completion of the
   * loop. Checks every precondition with a clear error before touching anything,
   * confirms, then `git merge --no-ff` the session branch into the base (with the
   * main repo already on the base — verified, never checked out behind the user's
   * back). On conflict it aborts the merge and leaves the session alone; on
   * success it runs the archive flow (worktree removed, branch KEPT).
   */
  async mergeSession(session: LiveSession): Promise<void> {
    const base = session.baseBranch ?? (await this.resolveBaseBranch());

    if (!(await branchExists(this.repoRoot, session.branch))) {
      void vscode.window.showErrorMessage(
        `Session branch "${session.branch}" does not exist — nothing to merge.`,
      );
      return;
    }
    if (!(await branchExists(this.repoRoot, base))) {
      void vscode.window.showErrorMessage(
        `Base branch "${base}" does not exist — cannot merge into it.`,
      );
      return;
    }
    if (!(await isWorkingTreeClean(this.repoRoot))) {
      void vscode.window.showErrorMessage(
        "The main repository has uncommitted changes — commit or stash your changes in the main repository first.",
      );
      return;
    }
    if (!(await isWorkingTreeClean(session.worktreePath))) {
      void vscode.window.showWarningMessage(
        `The session "${session.slug}" has uncommitted changes; ask the agent to commit them first (or commit them yourself in the session terminal) before merging.`,
      );
      return;
    }

    let head: string;
    try {
      head = await currentBranch(this.repoRoot);
    } catch {
      void vscode.window.showErrorMessage(
        `The main repository is on a detached HEAD, not the base branch "${base}". Check out "${base}" first.`,
      );
      return;
    }
    if (head !== base) {
      void vscode.window.showErrorMessage(
        `The main repository is on "${head}", not the base branch "${base}". Check out "${base}" first, then merge.`,
      );
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Merge branch "${session.branch}" into "${base}", then archive the session?\n\nThe worktree will be removed but branch "${session.branch}" is kept.`,
      { modal: true },
      "Merge & Archive",
    );
    if (confirm !== "Merge & Archive") {
      return;
    }

    try {
      await mergeNoFf(this.repoRoot, session.branch);
    } catch (err) {
      if (isMergeConflictError(err)) {
        try {
          await abortMerge(this.repoRoot);
        } catch {
          // Abort itself failing is unusual; the error below still points the
          // user at the branch to sort out manually.
        }
        void vscode.window.showErrorMessage(
          `Merging "${session.branch}" into "${base}" hit conflicts and was aborted. Resolve them manually (e.g. merge "${session.branch}" yourself), then try again. The session was left untouched.`,
        );
        return;
      }
      void vscode.window.showErrorMessage(
        `git merge failed: ${gitErrorMessage(err)}`,
      );
      return;
    }

    let mergeCommit = "";
    try {
      mergeCommit = await headShortSha(this.repoRoot);
    } catch {
      // Non-fatal: the merge succeeded; we just can't name the commit.
    }

    const archived = await this.archiveWithoutConfirm(session);
    if (archived) {
      void vscode.window.showInformationMessage(
        `Merged "${session.branch}" into "${base}"${mergeCommit ? ` (${mergeCommit})` : ""} and archived the session.`,
      );
    } else {
      void vscode.window.showWarningMessage(
        `Merged "${session.branch}" into "${base}"${mergeCommit ? ` (${mergeCommit})` : ""}, but the worktree could not be removed — archive the session manually.`,
      );
    }
  }

  /**
   * Fallback base branch for records created before `baseBranch` existed: the
   * repo's current HEAD branch, or `master` when HEAD is detached.
   */
  private async resolveBaseBranch(): Promise<string> {
    try {
      return await currentBranch(this.repoRoot);
    } catch {
      return "master";
    }
  }

  /**
   * Delete a session outright. On a LIVE session: remove the worktree, delete the
   * branch (safe `-d`, escalating to `-D` only after an explicit "work will be
   * LOST" confirmation), then drop the record. On an ARCHIVED session: the
   * worktree is already gone, so just delete the branch and drop the record.
   */
  async delete(session: LiveSession): Promise<void> {
    if (session.archived) {
      const confirm = await vscode.window.showWarningMessage(
        `Delete archived session "${session.slug}"?\n\nThis deletes branch "${session.branch}" and removes the record permanently.`,
        { modal: true },
        "Delete",
      );
      if (confirm !== "Delete") {
        return;
      }
      if (!(await this.deleteBranchInteractive(session.branch))) {
        return; // user declined force-delete of unmerged branch — record kept
      }
      await this.dropRecord(session.slug);
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete session "${session.slug}"?\n\nThis removes the worktree at ${session.worktreePath} AND deletes branch "${session.branch}". This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return;
    }

    this.disposeTerminal(session.slug);

    if (!(await this.ensureWorktreeGone(session))) {
      return; // aborted or failed — record kept
    }
    if (!(await this.deleteBranchInteractive(session.branch))) {
      // Worktree already gone but branch kept (declined force). Convert to an
      // archived record rather than losing track of the surviving branch.
      this.records = this.records.map((r) =>
        r.slug === session.slug ? { ...r, archived: true } : r,
      );
      await this.persist();
      this.onSessionsChanged(this.records);
      this.onChange();
      void vscode.window.showWarningMessage(
        `Worktree removed, but branch "${session.branch}" was kept (unmerged). The session moved to Archived.`,
      );
      return;
    }
    await this.dropRecord(session.slug);
  }

  /**
   * Send a message to a running session's Claude Code TUI. Input box → if the
   * session's terminal is open, type the text and submit it. No shell quoting is
   * involved: `sendText` writes raw characters straight into the interactive
   * prompt. Rejects empty input; strips a trailing newline. When no terminal is
   * open the session isn't running — offer to (re)open it via reveal.
   */
  async sendMessage(session: LiveSession): Promise<void> {
    const terminal = this.terminals.get(session.slug);
    if (!terminal) {
      const open = await vscode.window.showInformationMessage(
        `Session "${session.slug}" isn't running — no terminal is open.`,
        "Open Session",
      );
      if (open === "Open Session") {
        this.reveal(session);
      }
      return;
    }

    const raw = await vscode.window.showInputBox({
      title: `Message — ${session.slug}`,
      prompt: "Text to send to the running agent",
      placeHolder: "e.g. also update the changelog",
      ignoreFocusOut: true,
    });
    if (raw === undefined) {
      return; // cancelled
    }
    const text = raw.replace(/[\r\n]+$/, "").trim();
    if (text === "") {
      void vscode.window.showWarningMessage(
        "Message was empty — nothing sent.",
      );
      return;
    }
    terminal.show();
    terminal.sendText(text, true);
  }

  /**
   * Ensure the session's worktree is gone, returning true when it is. Handles two
   * distinct failure modes:
   *   - dirty worktree (`git worktree remove` refuses): escalate to `--force`
   *     after an explicit modal.
   *   - broken worktree ("is not a working tree" — e.g. an unborn-HEAD orphan or
   *     a dir deleted out from under git): offer a modal to clean up anyway with
   *     `git worktree prune` + a guarded recursive delete of the (managed) dir.
   */
  private async ensureWorktreeGone(session: LiveSession): Promise<boolean> {
    try {
      await removeWorktree(this.repoRoot, session.worktreePath, false);
      return true;
    } catch (err) {
      if (isNotAWorkingTreeError(err)) {
        return this.cleanupBrokenWorktree(session, gitErrorMessage(err));
      }
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
        // A worktree that force-remove still can't touch is effectively broken —
        // offer the same prune + manual cleanup path as a last resort.
        if (isNotAWorkingTreeError(err2)) {
          return this.cleanupBrokenWorktree(session, gitErrorMessage(err2));
        }
        void vscode.window.showErrorMessage(
          `git worktree remove --force failed: ${gitErrorMessage(err2)}`,
        );
        return false;
      }
    }
  }

  /**
   * Fallback for a worktree git no longer recognizes: modal-confirm, then
   * `git worktree prune` and delete the directory ourselves if it still exists.
   * The recursive delete is hard-asserted to a path under the managed worktrees
   * dir — a corrupted record can never aim it elsewhere.
   */
  private async cleanupBrokenWorktree(
    session: LiveSession,
    reason: string,
  ): Promise<boolean> {
    const clean = await vscode.window.showWarningMessage(
      `The worktree for "${session.slug}" is broken and can't be removed normally (${reason}).\n\nClean it up anyway? This prunes the stale worktree registration and deletes ${session.worktreePath} if it still exists.`,
      { modal: true },
      "Clean Up",
    );
    if (clean !== "Clean Up") {
      return false;
    }
    try {
      await pruneWorktrees(this.repoRoot);
    } catch (err) {
      // Prune failing is non-fatal; continue to the directory delete.
      void vscode.window.showWarningMessage(
        `git worktree prune reported: ${gitErrorMessage(err)}`,
      );
    }
    if (!isUnderWorktreesDir(this.repoRoot, session.worktreePath)) {
      void vscode.window.showErrorMessage(
        `Refusing to delete ${session.worktreePath}: it is outside the managed worktrees directory.`,
      );
      return false;
    }
    try {
      await fs.rm(session.worktreePath, { recursive: true, force: true });
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to delete ${session.worktreePath}: ${gitErrorMessage(err)}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Delete a branch, returning true when it is gone (or was already absent).
   * Tries the safe `-d` first; on an unmerged-branch rejection asks explicitly,
   * with "work will be LOST" wording, before the one sanctioned `-D`.
   */
  private async deleteBranchInteractive(branch: string): Promise<boolean> {
    if (!(await branchExists(this.repoRoot, branch))) {
      return true; // nothing to delete
    }
    try {
      await deleteBranch(this.repoRoot, branch);
      return true;
    } catch (err) {
      if (!isUnmergedBranchError(err)) {
        void vscode.window.showErrorMessage(
          `git branch -d failed: ${gitErrorMessage(err)}`,
        );
        return false;
      }
      const force = await vscode.window.showWarningMessage(
        `Branch "${branch}" is not merged; its work will be LOST if you delete it.\n\nForce-delete the branch?`,
        { modal: true },
        "Delete Anyway",
      );
      if (force !== "Delete Anyway") {
        return false;
      }
      try {
        await forceDeleteBranch(this.repoRoot, branch);
        return true;
      } catch (err2) {
        void vscode.window.showErrorMessage(
          `git branch -D failed: ${gitErrorMessage(err2)}`,
        );
        return false;
      }
    }
  }

  /** Drop a record entirely, then persist + repaint. */
  private async dropRecord(slug: string): Promise<void> {
    this.records = this.records.filter((r) => r.slug !== slug);
    await this.persist();
    this.onSessionsChanged(this.records);
    this.onChange();
  }

  /** Dispose and forget a session's terminal if we hold one. */
  private disposeTerminal(slug: string): void {
    const terminal = this.terminals.get(slug);
    if (terminal) {
      terminal.dispose();
      this.terminals.delete(slug);
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
