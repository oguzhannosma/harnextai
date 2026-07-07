import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { MemoryFormData } from "./shared/messages";

/**
 * Reader/writer for harness memory files (personal `.harness/memories/<agent>.md`
 * and team `.harness/team-memories/team.md`). Format per
 * `.harness/protocol/memory-protocol.md`:
 *
 *   <!-- budget: 2200 | used: 1408 -->
 *   - entry one
 *   ---
 *   - entry two
 *
 * No YAML frontmatter — a budget header comment, then `---`-separated entry
 * blocks. Pure Node (no `vscode`) so it stays unit-testable.
 */

const BUDGET_RE = /<!--\s*budget:\s*(\d+)\s*\|\s*used:\s*\d+\s*-->/;

export interface ParsedMemory {
  readonly budget: number;
  readonly entries: string[];
}

function stripBom(s: string): string {
  return s.replace(/^﻿/, "");
}

/**
 * Parse a memory file. If the budget header is missing/malformed, `defaultBudget`
 * is used. Everything after the header line is split on `---`-only lines into
 * entries; leading/trailing blank lines per entry are trimmed. Any non-budget
 * comment lines (e.g. team.md's `<!-- proposal: ... -->`) stay inside the first
 * entry and thus survive the round-trip.
 */
export function parseMemory(
  content: string,
  defaultBudget: number,
): ParsedMemory {
  const normalized = stripBom(content);
  const budgetMatch = normalized.match(BUDGET_RE);
  const budget = budgetMatch ? Number(budgetMatch[1]) : defaultBudget;

  const lines = normalized.split(/\r?\n/);
  // Find the budget header line (first line that is exactly the budget comment)
  // and treat everything after it as entry content.
  let contentStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (BUDGET_RE.test(lines[i]) && lines[i].trim().startsWith("<!--")) {
      contentStart = i + 1;
      break;
    }
  }
  const body = lines.slice(contentStart).join("\n");

  const entries = body
    .split(/^\s*---\s*$/m)
    .map((e) => e.replace(/^\n+|\n+$/g, ""))
    .filter((e) => e.trim() !== "");

  return { budget, entries };
}

/** Character count charged against the budget: the joined entry content. */
export function computeUsed(entries: readonly string[]): number {
  return entries.join("\n---\n").length;
}

/** Serialize entries back to the on-disk format, recomputing the `used` count. */
export function serializeMemory(
  budget: number,
  entries: readonly string[],
): string {
  const used = computeUsed(entries);
  const header = `<!-- budget: ${budget} | used: ${used} -->`;
  if (entries.length === 0) {
    return header + "\n";
  }
  return `${header}\n${entries.join("\n---\n")}\n`;
}

export async function readMemoryForm(
  filePath: string,
  defaultBudget: number,
): Promise<MemoryFormData> {
  const content = await fs.readFile(filePath, "utf8");
  const { budget, entries } = parseMemory(content, defaultBudget);
  return {
    kind: "memory",
    filePath,
    label: path.basename(filePath),
    budget,
    entries,
  };
}

export async function writeMemoryForm(
  filePath: string,
  data: MemoryFormData,
): Promise<void> {
  const entries = data.entries
    .map((e) => e.replace(/^\n+|\n+$/g, ""))
    .filter((e) => e.trim() !== "");
  await fs.writeFile(filePath, serializeMemory(data.budget, entries), "utf8");
}

export interface MemoryFileRef {
  readonly filePath: string;
  readonly label: string;
  /** Default budget to assume if the file has no header (2200 personal / 4000 team). */
  readonly defaultBudget: number;
}

/**
 * Enumerate the memory files to show in the tree: every `*.md` under
 * `memoriesDir` (personal, gitignored) plus the single team memory file if it
 * exists. Missing directories/files are skipped, never thrown.
 */
export async function loadMemoryFiles(
  memoriesDir: string,
  teamMemoryPath: string,
): Promise<MemoryFileRef[]> {
  const refs: MemoryFileRef[] = [];

  let entries: string[] = [];
  try {
    entries = await fs.readdir(memoriesDir);
  } catch {
    entries = [];
  }
  for (const file of entries.filter((f) => f.toLowerCase().endsWith(".md"))) {
    refs.push({
      filePath: path.join(memoriesDir, file),
      label: file,
      defaultBudget: 2200,
    });
  }
  refs.sort((a, b) => a.label.localeCompare(b.label));

  try {
    await fs.access(teamMemoryPath);
    refs.push({
      filePath: teamMemoryPath,
      label: `team.md (team)`,
      defaultBudget: 4000,
    });
  } catch {
    // No team memory file — omit.
  }

  return refs;
}
