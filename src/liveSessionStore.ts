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
}

/**
 * Derive a filesystem/branch-safe slug from a free-text task name, e.g.
 * `"Add search API"` -> `"add-search-api"`. Lower-cases, collapses any run of
 * non-alphanumerics to a single `-`, and trims leading/trailing dashes. May
 * return `''` for input with no alphanumerics — callers must guard.
 */
export function deriveSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
