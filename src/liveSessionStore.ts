import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

/**
 * Pure domain logic for the worktree-per-session lifecycle (Conductor-style).
 *
 * A "live session" is a git worktree + branch created for an agent to work a
 * single task in isolation. This module owns everything that can be reasoned
 * about without the extension host: the record shape, slug derivation, task-name
 * validation, git command construction/execution, `git worktree list` porcelain
 * parsing, and record reconciliation. It must NOT import `vscode` — all UI
 * wiring (input boxes, terminals, modals, persistence) lives in
 * {@link file://./liveSessionManager.ts}.
 *
 * Every git call uses `execFile` with an argument array — never a shell string —
 * so user-supplied task names can never be interpreted by a shell.
 */

const pExecFile = promisify(execFile);

/** A persisted live-session record. Stored in `workspaceState`. */
export interface LiveSession {
  /** URL/branch/dir-safe short name derived from the task name. Unique key. */
  readonly slug: string;
  /** The agent this session runs (`claude --agent <agentName>`). */
  readonly agentName: string;
  /** Git branch created for the worktree: `<agentName>/<slug>`. */
  readonly branch: string;
  /** Absolute path to the worktree directory. */
  readonly worktreePath: string;
  /** Epoch ms when the session was created. */
  readonly createdAt: number;
  /**
   * When true, the worktree has been removed but the branch is kept so the user
   * can return to the work later. Archived sessions render under the "Archived"
   * group and are no longer status-watched. Absent/false = a live session.
   */
  readonly archived?: boolean;
  /**
   * The repo's checked-out branch at `newSession` time — the diff/merge base for
   * the review loop. Absent on records created before this field existed; callers
   * fall back to the repo's current HEAD branch (or `master`) at review time.
   */
  readonly baseBranch?: string;
}

/**
 * Buffer cap for `git show`/`git diff` output. The default `execFile` cap (1 MB)
 * truncates and rejects on any moderately large file/diff; a session's changed
 * file can easily exceed that, so raise it well past any realistic source file.
 */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * One entry from `git diff --name-status`: a status letter plus the affected
 * path(s). For renames/copies (`R`/`C`) `oldPath` is the source and `path` the
 * destination; for every other status only `path` is set.
 */
export interface ChangedFile {
  /** Single upper-case status letter: A, M, D, R, C, T, U. */
  readonly status: string;
  /** Destination path (new path for renames), forward-slash separated as git emits. */
  readonly path: string;
  /** Source path for renames/copies only. */
  readonly oldPath?: string;
}

/**
 * Upper bound on a derived slug. A user can (and did) paste a whole sentence as
 * the task name; without a cap that becomes a 100+ char branch/dir name. The
 * full text is preserved separately as the launch prompt — see the manager's
 * New Session flow — so capping the slug loses nothing.
 */
export const MAX_SLUG_LEN = 40;

/**
 * Derive a filesystem/branch-safe slug from a free-text task name, e.g.
 * `"Add search API"` -> `"add-search-api"`. Lower-cases, collapses any run of
 * non-alphanumerics to a single `-`, and trims leading/trailing dashes. The
 * result is capped at {@link MAX_SLUG_LEN}, cut at a word (dash) boundary when
 * one falls in the back half so the slug stays readable rather than mid-word.
 * May return `''` for input with no alphanumerics — callers must guard.
 */
export function deriveSlug(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= MAX_SLUG_LEN) {
    return base;
  }
  const cut = base.slice(0, MAX_SLUG_LEN);
  const lastDash = cut.lastIndexOf("-");
  // Prefer a word boundary, but only if it keeps at least half the budget —
  // otherwise a slug like "supercalifragilistic..." with no early dash would be
  // chopped to almost nothing. Fall back to a hard cut with trailing dash trim.
  const capped = lastDash >= MAX_SLUG_LEN / 2 ? cut.slice(0, lastDash) : cut;
  return capped.replace(/-+$/g, "");
}

/**
 * Validate a task name for the New Session input box. Returns an error message
 * (shown inline by `showInputBox`) or `undefined` when valid.
 */
export function validateTaskName(value: string): string | undefined {
  if (!value || value.trim() === "") {
    return "Task name is required.";
  }
  if (deriveSlug(value) === "") {
    return "Task name must contain letters or numbers.";
  }
  return undefined;
}

/** Sibling-of-repo directory that holds all worktrees: `<repoParent>/intelligents-worktrees`. */
export function worktreesDir(repoRoot: string): string {
  return path.join(path.dirname(repoRoot), "intelligents-worktrees");
}

/** Absolute path for a session's worktree: `<worktreesDir>/<slug>`. */
export function worktreePathFor(repoRoot: string, slug: string): string {
  return path.join(worktreesDir(repoRoot), slug);
}

/** Branch name for a session: `<agentName>/<slug>`. */
export function branchFor(agentName: string, slug: string): string {
  return `${agentName}/${slug}`;
}

/**
 * True when {@link repoRoot} has at least one commit. `git worktree add -b` on an
 * unborn HEAD silently infers `--orphan`, producing a bogus empty worktree that
 * later refuses `git worktree remove` ("is not a working tree"). Callers must
 * gate New Session on this and abort with a clear message when it is false, so
 * git is never allowed to infer `--orphan`.
 */
export async function repoHasCommits(repoRoot: string): Promise<boolean> {
  try {
    await pExecFile("git", ["-C", repoRoot, "rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false; // unborn HEAD (no commits) — rev-parse exits non-zero
  }
}

/** `git worktree prune` — drops registrations for worktrees whose dir is gone. */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await pExecFile("git", ["-C", repoRoot, "worktree", "prune"]);
}

/** True when a local branch {@link branch} exists in {@link repoRoot}. */
export async function branchExists(
  repoRoot: string,
  branch: string,
): Promise<boolean> {
  try {
    await pExecFile("git", [
      "-C",
      repoRoot,
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * `git branch -D <branch>` — force delete, discarding unmerged work. Only ever
 * called after an explicit second modal confirmation (unmerged branches refuse
 * the safe `-d`); never on the archive path.
 */
export async function forceDeleteBranch(
  repoRoot: string,
  branch: string,
): Promise<void> {
  await pExecFile("git", ["-C", repoRoot, "branch", "-D", branch]);
}

/**
 * True when {@link candidate} resolves to a path inside {@link repoRoot}'s managed
 * worktrees dir. A hard guard the manager asserts before any recursive `fs.rm`,
 * so a corrupted record can never point the delete at an arbitrary directory.
 */
export function isUnderWorktreesDir(
  repoRoot: string,
  candidate: string,
): boolean {
  const base = normalizePath(worktreesDir(repoRoot));
  const target = normalizePath(candidate);
  if (target === base) {
    return false; // the dir itself, not a child — never delete the whole store
  }
  const withSep = base.endsWith(path.sep) ? base : base + path.sep;
  return target.startsWith(withSep);
}

/**
 * True when a rejected git call is the "is not a working tree" failure seen when
 * a worktree was created bogus (unborn-HEAD `--orphan`) or its dir was deleted
 * out from under git. This is the signal to fall back to prune + manual cleanup.
 */
export function isNotAWorkingTreeError(err: unknown): boolean {
  return /is not a working tree/i.test(gitErrorMessage(err));
}

/** True when a rejected `git branch -d` failed because the branch is unmerged. */
export function isUnmergedBranchError(err: unknown): boolean {
  return /not fully merged/i.test(gitErrorMessage(err));
}

/**
 * Quote a free-text prompt as a single shell argument for
 * `claude --agent <name> <prompt>` sent via `terminal.sendText`.
 *
 * The terminal's shell is unknown and varies (PowerShell is the Windows default,
 * but users configure cmd, Git Bash, zsh, …). Double-quote wrapping is the one
 * quoting form every one of those shells treats as a single argument, so we wrap
 * in `"` and downgrade any inner `"` to `'` — the only character that would
 * otherwise close the quote and split the argument. We deliberately do NOT try to
 * escape `$`/backtick per-shell: getting the argument *boundary* right is what
 * matters (a task sentence stays one arg), and task prompts practically never
 * contain shell metacharacters. Newlines are collapsed to spaces so the whole
 * prompt lands on the single command line `sendText` submits.
 */
export function quotePromptArg(prompt: string): string {
  const oneLine = prompt
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .trim();
  return `"${oneLine}"`;
}

/**
 * `git worktree add <worktreePath> -b <branch>`. Rejects (with git stderr on the
 * error object) if the branch already exists, the path exists, or the repo state
 * blocks it. Runs against {@link repoRoot} via `-C` so no cwd juggling is needed.
 */
export async function addWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  await pExecFile("git", [
    "-C",
    repoRoot,
    "worktree",
    "add",
    worktreePath,
    "-b",
    branch,
  ]);
}

/**
 * `git worktree remove [--force] <worktreePath>`. `force` is only passed when the
 * caller has explicitly re-confirmed (dirty worktrees otherwise refuse to remove).
 */
export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  force: boolean,
): Promise<void> {
  const args = ["-C", repoRoot, "worktree", "remove"];
  if (force) {
    args.push("--force");
  }
  args.push(worktreePath);
  await pExecFile("git", args);
}

/**
 * `git branch -d <branch>` — safe delete only. Rejects (unmerged) rather than
 * force-deleting; callers surface that and keep the branch.
 */
export async function deleteBranch(
  repoRoot: string,
  branch: string,
): Promise<void> {
  await pExecFile("git", ["-C", repoRoot, "branch", "-d", branch]);
}

/** `git worktree list --porcelain` -> the absolute worktree paths it reports. */
export async function listWorktreePaths(repoRoot: string): Promise<string[]> {
  const { stdout } = await pExecFile("git", [
    "-C",
    repoRoot,
    "worktree",
    "list",
    "--porcelain",
  ]);
  return parseWorktreePorcelain(stdout);
}

/**
 * Parse `git worktree list --porcelain` stdout into worktree paths. Porcelain
 * emits one stanza per worktree, each beginning with a `worktree <path>` line
 * (git prints these with forward slashes even on Windows).
 */
export function parseWorktreePorcelain(stdout: string): string[] {
  const prefix = "worktree ";
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
    .filter((p) => p.length > 0);
}

/** Normalize a path for cross-source comparison (case-insensitive on Windows). */
function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Drop persisted records whose worktree git no longer knows about (removed
 * outside the extension). {@link existingPaths} is the output of
 * {@link listWorktreePaths}. Comparison is path-normalized.
 */
export function reconcileRecords(
  records: readonly LiveSession[],
  existingPaths: readonly string[],
): LiveSession[] {
  const known = new Set(existingPaths.map(normalizePath));
  return records.filter((r) => known.has(normalizePath(r.worktreePath)));
}

// -- review loop: diff review + merge & archive ----------------------------

/**
 * `git symbolic-ref --short HEAD` -> the checked-out branch name. Rejects when
 * HEAD is detached (no branch), which callers treat as "can't determine base".
 */
export async function currentBranch(repoRoot: string): Promise<string> {
  const { stdout } = await pExecFile("git", [
    "-C",
    repoRoot,
    "symbolic-ref",
    "--short",
    "HEAD",
  ]);
  return stdout.trim();
}

/** `git merge-base <a> <b>` -> the common-ancestor commit sha. */
export async function mergeBase(
  repoRoot: string,
  a: string,
  b: string,
): Promise<string> {
  const { stdout } = await pExecFile("git", [
    "-C",
    repoRoot,
    "merge-base",
    a,
    b,
  ]);
  return stdout.trim();
}

/** `git diff --name-status <from> <to>` -> parsed {@link ChangedFile} list. */
export async function diffNameStatus(
  repoRoot: string,
  from: string,
  to: string,
): Promise<ChangedFile[]> {
  const { stdout } = await pExecFile(
    "git",
    ["-C", repoRoot, "diff", "--name-status", from, to],
    { maxBuffer: GIT_MAX_BUFFER },
  );
  return parseNameStatus(stdout);
}

/**
 * Parse `git diff --name-status` stdout. Each line is a tab-separated status
 * code and one path (two paths for renames/copies: `R100<TAB>old<TAB>new`). The
 * status is normalized to its leading letter (git appends a similarity score to
 * `R`/`C`). Blank lines are skipped. Pure — the unit-test seam for this feature.
 */
export function parseNameStatus(stdout: string): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    const parts = line.split("\t");
    const letter = parts[0].charAt(0).toUpperCase();
    if ((letter === "R" || letter === "C") && parts.length >= 3) {
      out.push({ status: letter, oldPath: parts[1], path: parts[2] });
    } else if (parts.length >= 2) {
      out.push({ status: letter, path: parts[1] });
    }
  }
  return out;
}

/**
 * `git show <ref>:<filePath>` -> the file's content at that ref. Returns `''`
 * when the file does not exist at the ref (git rejects) — which is exactly the
 * desired left/right side for added files (absent at the base) and deleted files
 * (absent in the branch), so callers need no added/deleted special-casing.
 */
export async function showFileAtRef(
  repoRoot: string,
  ref: string,
  filePath: string,
): Promise<string> {
  try {
    const { stdout } = await pExecFile(
      "git",
      ["-C", repoRoot, "show", `${ref}:${filePath}`],
      { maxBuffer: GIT_MAX_BUFFER },
    );
    return stdout;
  } catch {
    return "";
  }
}

/** True when `git status --porcelain` reports nothing (no uncommitted changes). */
export async function isWorkingTreeClean(repoRoot: string): Promise<boolean> {
  const { stdout } = await pExecFile("git", [
    "-C",
    repoRoot,
    "status",
    "--porcelain",
  ]);
  return stdout.trim() === "";
}

/**
 * `git merge --no-ff <branch>` in {@link repoRoot} (must already be on the base
 * branch — the caller verifies that). Rejects on conflict; the rejection carries
 * git's stdout ("CONFLICT…"), which {@link isMergeConflictError} detects.
 */
export async function mergeNoFf(
  repoRoot: string,
  branch: string,
): Promise<void> {
  await pExecFile("git", ["-C", repoRoot, "merge", "--no-ff", branch]);
}

/** `git merge --abort` — unwind an in-progress conflicted merge. */
export async function abortMerge(repoRoot: string): Promise<void> {
  await pExecFile("git", ["-C", repoRoot, "merge", "--abort"]);
}

/** `git rev-parse --short HEAD` -> the current commit's short sha. */
export async function headShortSha(repoRoot: string): Promise<string> {
  const { stdout } = await pExecFile("git", [
    "-C",
    repoRoot,
    "rev-parse",
    "--short",
    "HEAD",
  ]);
  return stdout.trim();
}

/**
 * True when a rejected `git merge` failed because of conflicts. Git prints
 * "CONFLICT" / "Automatic merge failed" to *stdout* (not stderr), so this checks
 * the combined output rather than {@link gitErrorMessage} (stderr-only).
 */
export function isMergeConflictError(err: unknown): boolean {
  return /conflict|automatic merge failed/i.test(gitErrorOutput(err));
}

/** Combined stdout+stderr+message of a rejected `execFile`, for output sniffing. */
export function gitErrorOutput(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stdout?: unknown; stderr?: unknown; message?: unknown };
    const parts = [e.stdout, e.stderr, e.message]
      .filter((p): p is string => typeof p === "string")
      .join("\n");
    if (parts.trim() !== "") {
      return parts;
    }
  }
  return String(err);
}

/**
 * Extract git's stderr from a rejected `execFile` promise for user-facing error
 * messages. Falls back to the error message, then a generic string.
 */
export function gitErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: unknown; message?: unknown };
    if (typeof e.stderr === "string" && e.stderr.trim() !== "") {
      return e.stderr.trim();
    }
    if (typeof e.message === "string" && e.message.trim() !== "") {
      return e.message.trim();
    }
  }
  return String(err);
}
