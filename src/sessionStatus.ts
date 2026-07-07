import { promises as fs } from "node:fs";
import * as path from "node:path";
import { sanitizeCwd } from "./sessionStore";

/**
 * Best-effort classification of a live Claude Code session's state from the tail
 * of its transcript `.jsonl`. Adapts Herdr's working/blocked/done glance-state
 * (see `docs/research/2026-07-07-inspirations-and-vscode-feasibility.md` §5.4).
 *
 * Pure Node (no `vscode`). Every read is a tail read — files routinely exceed
 * 1 MB and must never be slurped whole — and every field access is defensive:
 * the transcript is an undocumented internal format that drifts with Claude Code
 * releases (§4 caveat), so anything unrecognized degrades to {@link 'unknown'}
 * (no badge) and never throws.
 *
 * ## On the missing 'blocked' signal
 * The union below includes `'blocked'` for forward-compatibility and so the tree
 * can render a "waiting on the human" badge, but {@link classifySession} does not
 * currently return it. Verified empirically against real transcripts on Claude
 * Code 2.1.202 (2026-07-07): the top-level record types written are only `mode`,
 * `permission-mode`, `file-history-snapshot`, `user`, `system`, `assistant`,
 * `attachment`, `ai-title`, `last-prompt`, and `queue-operation`. There is **no**
 * permission-request / approval-pending record. A tool awaiting the human's
 * permission looks identical on disk to a tool that is mid-execution — both are
 * simply a trailing `assistant` `tool_use` with no `tool_result` yet — so there
 * is no observable "blocked" signal to key off. Per the task's guidance we do NOT
 * fabricate a time-based heuristic we cannot verify; a trailing `tool_use` is
 * classified as {@link 'working'}. If a future Claude Code version emits a real
 * permission-pending record, teach {@link classifyRecords} to recognize it and
 * the rest of the pipeline (badge + notification) already handles it.
 */

/** Glance-state of a session. `'unknown'` renders no badge. */
export type SessionStatus = "working" | "blocked" | "idle" | "unknown";

/** Bytes of the file tail to read on the first pass. */
const INITIAL_TAIL_BYTES = 128 * 1024;
/** Upper bound when the first pass finds no meaningful record (huge trailing
 * tool_result can push the last message far from EOF). Never reads more than this
 * even for multi-MB files. */
const MAX_TAIL_BYTES = 1024 * 1024;

/**
 * Classify the session whose transcript is at {@link jsonlPath}. Missing file,
 * unreadable file, or no recognizable message record all yield `'unknown'`.
 */
export async function classifySession(
  jsonlPath: string,
): Promise<SessionStatus> {
  let records: unknown[];
  try {
    records = await readTailRecords(jsonlPath);
  } catch {
    return "unknown";
  }
  return classifyRecords(records);
}

/**
 * Classify from an ordered array of already-parsed transcript records (oldest to
 * newest). Split out from I/O so it is trivially unit-testable. Walks backward to
 * the last "meaningful" record — a real `assistant` turn or a non-meta `user`
 * record — and inspects its content blocks. Trailing bookkeeping records
 * (`system`, `queue-operation`, `mode`, `permission-mode`, `file-history-snapshot`,
 * …) are skipped so they never mask the true last activity.
 */
export function classifyRecords(records: readonly unknown[]): SessionStatus {
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i];
    if (!rec || typeof rec !== "object") {
      continue;
    }
    const r = rec as { type?: unknown; isMeta?: unknown; message?: unknown };
    const isAssistant = r.type === "assistant";
    const isUser = r.type === "user" && r.isMeta !== true;
    if (!isAssistant && !isUser) {
      continue; // bookkeeping record — keep looking backward
    }

    const content = (r.message as { content?: unknown } | undefined)?.content;
    if (isAssistant) {
      // Assistant turn that fired a tool and is awaiting its result → mid-loop.
      return hasBlockType(content, "tool_use") ? "working" : "idle";
    }
    // User record: a tool_result means the tool just returned and the assistant
    // is about to continue (working); a plain prompt means the agent is
    // generating its reply (also working). Either way the loop is live.
    return "working";
  }
  return "unknown";
}

/** True when {@link content} is a block array containing a block of {@link type}. */
function hasBlockType(content: unknown, type: string): boolean {
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(
    (block) =>
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === type,
  );
}

/**
 * Read the tail of a `.jsonl` file and return its parsed records in file order.
 * Reads at most {@link MAX_TAIL_BYTES}. When the read starts mid-file the first
 * (likely partial) line is dropped; unparseable lines — including a torn final
 * line from an in-progress append — are silently skipped.
 */
async function readTailRecords(jsonlPath: string): Promise<unknown[]> {
  const handle = await fs.open(jsonlPath, "r");
  try {
    const { size } = await handle.stat();
    let records = await readWindow(
      handle,
      size,
      Math.min(size, INITIAL_TAIL_BYTES),
    );
    // If a giant trailing tool_result pushed the last message out of the first
    // window, widen once (still capped) rather than reading the whole file.
    if (records.length === 0 && size > INITIAL_TAIL_BYTES) {
      records = await readWindow(handle, size, Math.min(size, MAX_TAIL_BYTES));
    }
    return records;
  } finally {
    await handle.close();
  }
}

/** Read the last {@link windowBytes} of a {@link size}-byte file and parse lines. */
async function readWindow(
  handle: import("node:fs").promises.FileHandle,
  size: number,
  windowBytes: number,
): Promise<unknown[]> {
  const start = Math.max(0, size - windowBytes);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  await handle.read(buffer, 0, length, start);
  const text = buffer.toString("utf8");

  const lines = text.split(/\r?\n/);
  // A partial first line only exists when we did not start at byte 0.
  if (start > 0 && lines.length > 0) {
    lines.shift();
  }

  const records: unknown[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Malformed / torn line (partial write) — skip.
    }
  }
  return records;
}

/**
 * Find the active transcript for a worktree cwd: the most-recently-modified
 * `*.jsonl` directly under `~/.claude/projects/<sanitized-worktree-cwd>/`. Note
 * the sanitized name is derived from the **worktree** path, not the repo root, so
 * each session's worktree has its own project dir. Returns `undefined` when the
 * dir is missing or holds no transcripts.
 */
export async function findActiveTranscript(
  homeDir: string,
  worktreeCwd: string,
): Promise<string | undefined> {
  const projectDir = await resolveProjectDir(homeDir, worktreeCwd);
  if (!projectDir) {
    return undefined;
  }

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(projectDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  let newestPath: string | undefined;
  let newestMtime = -Infinity;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) {
      continue;
    }
    const filePath = path.join(projectDir, entry.name);
    try {
      const { mtimeMs } = await fs.stat(filePath);
      if (mtimeMs > newestMtime) {
        newestMtime = mtimeMs;
        newestPath = filePath;
      }
    } catch {
      // Vanished between readdir and stat — ignore.
    }
  }
  return newestPath;
}

/**
 * Resolve `~/.claude/projects/<sanitized-cwd>`, matching case-insensitively
 * against the real listing (Windows drive-letter casing drifts). Mirrors the
 * resolver in {@link file://./sessionStore.ts}.
 */
async function resolveProjectDir(
  homeDir: string,
  cwd: string,
): Promise<string | undefined> {
  const projectsRoot = path.join(homeDir, ".claude", "projects");
  const wanted = sanitizeCwd(cwd);
  const direct = path.join(projectsRoot, wanted);
  try {
    if ((await fs.stat(direct)).isDirectory()) {
      return direct;
    }
  } catch {
    // Fall through to a case-insensitive scan.
  }
  try {
    const names = await fs.readdir(projectsRoot);
    const match = names.find((n) => n.toLowerCase() === wanted.toLowerCase());
    return match ? path.join(projectsRoot, match) : undefined;
  } catch {
    return undefined;
  }
}
