import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Pure domain logic for listing a repo's open GitHub issues via the `gh` CLI.
 * Everything here is reasoned about without the extension host: the record shape,
 * the `gh` argument construction, and the JSON parsing. It must NOT import
 * `vscode` — the Workflow tree ({@link file://./workflowTree.ts}) supplies a
 * bound {@link ExecFn} and renders the results.
 *
 * The command runner is injected so unit tests can feed canned `gh` output
 * without a network call or a `gh` install.
 */

const pExecFile = promisify(execFile);

/**
 * `gh issue list` JSON can be large on busy repos; the default `execFile` 1 MB
 * cap would truncate and reject. Raise it well past any realistic issue list.
 */
const GH_MAX_BUFFER = 16 * 1024 * 1024;

/** Upper bound on how many issues to fetch — one screen's worth, newest first. */
const ISSUE_LIMIT = 100;

/** A single open GitHub issue as surfaced in the Workflow tree. */
export interface GitHubIssue {
  /** Issue number (the `#N` the runtime is pointed at). */
  readonly number: number;
  /** Issue title. */
  readonly title: string;
  /** `html_url` for the issue (tooltip / open-in-browser). */
  readonly url: string;
  /** Issue state as `gh` reports it (always `OPEN` for our query). */
  readonly state: string;
  /** Label names, in the order `gh` returns them. */
  readonly labels: readonly string[];
}

/**
 * Injectable, `execFile`-shaped command runner — the unit-test seam. Real callers
 * use {@link makeGhExec} (bound to the repo root as cwd); tests pass a fake that
 * returns canned stdout and can assert on the args.
 */
export type ExecFn = (
  command: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr?: string }>;

/** The `gh` args that list open issues as JSON. Exposed for the args assertion in tests. */
export const GH_ISSUE_LIST_ARGS: readonly string[] = [
  "issue",
  "list",
  "--state",
  "open",
  "--limit",
  String(ISSUE_LIMIT),
  "--json",
  "number,title,url,state,labels",
];

/**
 * Build a default {@link ExecFn} that runs the real `gh` binary with {@link repoRoot}
 * as its working directory (so `gh` resolves the repo from the checkout). Kept out
 * of the tree module so the tree stays wiring-only.
 */
export function makeGhExec(repoRoot: string): ExecFn {
  return (command, args) =>
    pExecFile(command, args as string[], {
      cwd: repoRoot,
      maxBuffer: GH_MAX_BUFFER,
    });
}

/**
 * List the repo's open issues via `gh issue list --json …`. Returns them in the
 * order `gh` emits (newest first). Rejects if `gh` itself fails (not installed,
 * not authenticated, not a GitHub repo) — the caller surfaces that.
 */
export async function listOpenIssues(exec: ExecFn): Promise<GitHubIssue[]> {
  const { stdout } = await exec("gh", GH_ISSUE_LIST_ARGS);
  return parseIssues(stdout);
}

/**
 * Parse `gh issue list --json number,title,url,state,labels` stdout into
 * {@link GitHubIssue} records. Defensive: tolerates empty output, non-array JSON,
 * and missing/oddly-typed fields (skipping entries without a numeric `number`),
 * since the `gh` JSON schema can drift across releases. Pure — the unit-test seam.
 */
export function parseIssues(stdout: string): GitHubIssue[] {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: GitHubIssue[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.number !== "number") {
      continue;
    }
    out.push({
      number: e.number,
      title: typeof e.title === "string" ? e.title : "",
      url: typeof e.url === "string" ? e.url : "",
      state: typeof e.state === "string" ? e.state : "",
      labels: parseLabels(e.labels),
    });
  }
  return out;
}

/**
 * Extract label names from `gh`'s `labels` field, an array of `{ name, … }`
 * objects. Skips entries without a string name so a schema change can't crash the
 * parse.
 */
function parseLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  for (const label of value) {
    if (label && typeof label === "object") {
      const name = (label as Record<string, unknown>).name;
      if (typeof name === "string" && name !== "") {
        names.push(name);
      }
    }
  }
  return names;
}
