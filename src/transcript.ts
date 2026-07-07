import { createReadStream } from "node:fs";
import * as readline from "node:readline";
import type {
  TranscriptPart,
  TranscriptTurn,
  TranscriptView,
} from "./shared/messages";

/**
 * Read-only simplification of a Claude Code session transcript `.jsonl` into a
 * turn-by-turn view for the transcript webview. Pure Node (no `vscode`) so the
 * simplification logic stays unit-testable.
 *
 * The transcript is an undocumented internal format (see {@link file://./sessionStore.ts}
 * for the sanitized-path and record-shape notes), so every field access here is
 * defensive: a malformed line, an unexpected record type, or a missing field
 * degrades to "skip this record" and never throws.
 *
 * What survives into the view:
 *  - genuine `user` turns — the text content, skipping the meta / `<`-wrapped
 *    command echoes and skipping `tool_result` blocks (tool OUTPUT is noise).
 *  - `assistant` turns — text blocks verbatim, and each `tool_use` block rendered
 *    as a compact one-liner marker (`⚙ ToolName`). Tool INPUTS are never carried.
 *  - everything else (bookkeeping record types: `system`, `mode`, `attachment`,
 *    `file-history-snapshot`, `queue-operation`, `ai-title`, …) is dropped.
 */

/** Max renderable turns kept; longer transcripts render only the last N. */
export const DEFAULT_TURN_CAP = 500;
/** Per-text soft cap so a giant paste/output can't bloat the webview payload. */
const MAX_TEXT_CHARS = 8000;

/** True for user content that is empty or a Claude Code XML wrapper echo. Mirrors
 * `isNoise` in sessionStore — genuine human prose never starts with `<`. */
function isUserNoise(text: string): boolean {
  const t = text.trim();
  return t === "" || t.startsWith("<");
}

function clampText(text: string): string {
  const t = text.trim();
  return t.length > MAX_TEXT_CHARS ? t.slice(0, MAX_TEXT_CHARS - 1) + "…" : t;
}

/**
 * Collect the plain-text pieces of a user `message.content`, which is either a
 * bare string or an array of blocks. `tool_result` blocks are skipped (tool
 * output, not human prose); `<`-wrapped / empty text is skipped as noise.
 */
function userTextParts(content: unknown): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  if (typeof content === "string") {
    if (!isUserNoise(content)) {
      parts.push({ kind: "text", text: clampText(content) });
    }
    return parts;
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const b = block as { type?: unknown; text?: unknown };
      if (
        b.type === "text" &&
        typeof b.text === "string" &&
        !isUserNoise(b.text)
      ) {
        parts.push({ kind: "text", text: clampText(b.text) });
      }
      // tool_result and any other block types are intentionally dropped.
    }
  }
  return parts;
}

/**
 * Assistant `message.content` is an array of blocks. Text blocks render as prose
 * (empty ones dropped); `tool_use` blocks render as a compact `⚙ ToolName`
 * marker with no input. `thinking` and unknown block types are dropped.
 */
function assistantParts(content: unknown): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  if (!Array.isArray(content)) {
    return parts;
  }
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const b = block as { type?: unknown; text?: unknown; name?: unknown };
    if (b.type === "text" && typeof b.text === "string") {
      const text = clampText(b.text);
      if (text !== "") {
        parts.push({ kind: "text", text });
      }
    } else if (b.type === "tool_use") {
      const name = typeof b.name === "string" && b.name ? b.name : "tool";
      parts.push({ kind: "tool", name });
    }
  }
  return parts;
}

/**
 * Convert a single parsed transcript record into a renderable turn, or `null`
 * when the record contributes nothing (bookkeeping type, meta user echo, empty
 * assistant turn, etc.). Split out so it is exercised directly by unit tests.
 */
export function recordToTurn(record: unknown): TranscriptTurn | null {
  if (!record || typeof record !== "object") {
    return null;
  }
  const r = record as { type?: unknown; isMeta?: unknown; message?: unknown };
  const content = (r.message as { content?: unknown } | undefined)?.content;

  if (r.type === "user" && r.isMeta !== true) {
    const parts = userTextParts(content);
    return parts.length > 0 ? { role: "user", parts } : null;
  }
  if (r.type === "assistant") {
    const parts = assistantParts(content);
    return parts.length > 0 ? { role: "assistant", parts } : null;
  }
  return null;
}

/**
 * Simplify an already-parsed, in-order record array into a capped turn view.
 * Keeps only the last {@link cap} renderable turns; `total` is the full
 * renderable count and `truncated` says whether trimming happened. Pure — the
 * I/O-free core shared by {@link loadTranscript} and the unit tests.
 */
export function simplifyRecords(
  records: readonly unknown[],
  title: string,
  cap: number = DEFAULT_TURN_CAP,
): TranscriptView {
  const turns: TranscriptTurn[] = [];
  let total = 0;
  for (const record of records) {
    const turn = recordToTurn(record);
    if (!turn) {
      continue;
    }
    total++;
    turns.push(turn);
    if (turns.length > cap) {
      turns.shift();
    }
  }
  return { title, turns, total, truncated: total > cap };
}

/**
 * Stream a transcript file line-by-line and produce its simplified, capped turn
 * view. Never slurps the whole file: parsing is per-line and only the last
 * {@link cap} turns are retained in memory (a torn/partial final line simply
 * fails JSON.parse and is skipped). A missing/unreadable file yields an empty
 * view rather than throwing.
 */
export function loadTranscript(
  filePath: string,
  title: string,
  cap: number = DEFAULT_TURN_CAP,
): Promise<TranscriptView> {
  return new Promise((resolve) => {
    const turns: TranscriptTurn[] = [];
    let total = 0;
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ title, turns, total, truncated: total > cap });
    };

    let stream: ReturnType<typeof createReadStream>;
    try {
      stream = createReadStream(filePath, { encoding: "utf8" });
    } catch {
      finish();
      return;
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed === "") {
        return;
      }
      let record: unknown;
      try {
        record = JSON.parse(trimmed);
      } catch {
        return; // malformed / torn line — skip
      }
      const turn = recordToTurn(record);
      if (!turn) {
        return;
      }
      total++;
      turns.push(turn);
      if (turns.length > cap) {
        turns.shift();
      }
    });
    rl.on("close", finish);
    rl.on("error", finish);
    stream.on("error", finish);
  });
}
