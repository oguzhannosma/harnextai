import { promises as fs, createReadStream } from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

/**
 * Read-only listing of Claude Code session transcripts for the current
 * workspace. Transcripts live at
 * `~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl` (verified on Claude
 * Code 2.1.202). These are undocumented internal formats, so every field access
 * here is defensive: a missing dir, empty file, or malformed JSON line degrades
 * to a fallback and never throws.
 *
 * Pure Node (no `vscode`).
 */

export interface SessionInfo {
  /** Session UUID = the `.jsonl` basename. Passed to `claude --resume`. */
  readonly sessionId: string;
  readonly filePath: string;
  readonly mtimeMs: number;
  /** First meaningful user prompt, truncated — the human-readable label. */
  readonly firstPrompt: string;
}

/**
 * Convert an absolute cwd to Claude Code's sanitized project-dir name: `:` and
 * path separators each become `-` (e.g. `C:\Users\x` -> `C--Users-x`).
 */
export function sanitizeCwd(cwd: string): string {
  return cwd.replace(/[:\\/]/g, "-");
}

/** Resolve `~/.claude/projects/<sanitized-cwd>`, matching case-insensitively
 * against the real directory listing (Windows drive-letter casing drifts). */
async function resolveProjectDir(
  homeDir: string,
  cwd: string,
): Promise<string | undefined> {
  const projectsRoot = path.join(homeDir, ".claude", "projects");
  const wanted = sanitizeCwd(cwd);
  const direct = path.join(projectsRoot, wanted);
  try {
    const stat = await fs.stat(direct);
    if (stat.isDirectory()) {
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

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text"
      ) {
        const text = (block as { text?: unknown }).text;
        if (typeof text === "string") {
          return text;
        }
      }
    }
  }
  return "";
}

/**
 * Skip prompts that aren't a real human first message: empty content, and the
 * XML-ish wrapper echoes Claude Code injects (`<local-command-caveat>`,
 * `<command-name>`, `<bash-input>`, `<bash-stdout>`, `<system-reminder>`, …).
 * Genuine human prompts effectively never start with `<`, so that single check
 * covers all of them robustly.
 */
function isNoise(text: string): boolean {
  const t = text.trim();
  return t === "" || t.startsWith("<");
}

/**
 * Stream a transcript and return the first meaningful user prompt, or '' if none
 * is found. Reads line-by-line and stops early — never loads the whole file.
 */
export async function readFirstUserPrompt(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value: string) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };
    let stream: ReturnType<typeof createReadStream>;
    try {
      stream = createReadStream(filePath, { encoding: "utf8" });
    } catch {
      finish("");
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
        return; // malformed line — skip
      }
      if (!record || typeof record !== "object") {
        return;
      }
      const rec = record as {
        type?: unknown;
        isMeta?: unknown;
        message?: unknown;
      };
      if (rec.type !== "user" || rec.isMeta === true) {
        return;
      }
      const message = rec.message as { content?: unknown } | undefined;
      const text = extractText(message?.content);
      if (isNoise(text)) {
        return;
      }
      // Resolve BEFORE closing: rl.close() emits 'close' synchronously, whose
      // handler would otherwise resolve '' first and win.
      finish(text.trim());
      rl.close();
    });
    rl.on("close", () => finish(""));
    rl.on("error", () => finish(""));
    stream.on("error", () => finish(""));
  });
}

/**
 * List sessions for the given workspace cwd, newest first. Missing project dir
 * yields an empty list. Only `*.jsonl` files (not the per-session sub-dirs) are
 * considered.
 */
export async function loadSessions(
  homeDir: string,
  cwd: string,
): Promise<SessionInfo[]> {
  const projectDir = await resolveProjectDir(homeDir, cwd);
  if (!projectDir) {
    return [];
  }

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const jsonlFiles = entries.filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(".jsonl"),
  );

  const sessions: SessionInfo[] = [];
  for (const entry of jsonlFiles) {
    const filePath = path.join(projectDir, entry.name);
    let mtimeMs = 0;
    try {
      mtimeMs = (await fs.stat(filePath)).mtimeMs;
    } catch {
      continue;
    }
    const firstPrompt = await readFirstUserPrompt(filePath);
    sessions.push({
      sessionId: entry.name.replace(/\.jsonl$/i, ""),
      filePath,
      mtimeMs,
      firstPrompt,
    });
  }

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions;
}

/** Human-friendly relative time like "3m ago", "2h ago", "5d ago". */
export function formatRelativeTime(
  ms: number,
  now: number = Date.now(),
): string {
  const diff = Math.max(0, now - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) {
    return "just now";
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);
  if (day < 30) {
    return `${day}d ago`;
  }
  const mon = Math.floor(day / 30);
  if (mon < 12) {
    return `${mon}mo ago`;
  }
  return `${Math.floor(mon / 12)}y ago`;
}
