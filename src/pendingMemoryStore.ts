import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseMemory, serializeMemory, computeUsed } from "./memoryStore";

/**
 * Pending team-memory proposals — the `.harness/team-memories/.pending/*.md`
 * staging tier from `.harness/protocol/memory-protocol.md`. An agent writes a
 * proposal file (a candidate `team.md` entry plus one line of justification); a
 * human approves it (append to `team.md`, delete the proposal) or rejects it
 * (delete the proposal) via this CRM — the dashboard the protocol refers to.
 *
 * Pure Node (no `vscode`) so the parsing/append/budget logic stays unit-testable.
 *
 * ## Proposal file format
 *
 * No real proposal file has ever been committed (only `.gitkeep`), and the
 * protocol only says a proposal "contain[s] the candidate entry and one line of
 * justification". So the exact shape is inferred, and {@link stripProposalMetadata}
 * is deliberately lenient: it drops whole-line HTML comments (e.g.
 * `<!-- proposal: append to team-memories/team.md -->`, the very marker that
 * leaked into the current `team.md`) and any `justification:`-labelled line,
 * leaving the durable entry (typically `- Dense fact.` bullets) behind.
 */

/** A proposal file staged for human approval. */
export interface PendingProposal {
  /** Absolute path to the `.pending/<slug>.md` file. */
  readonly filePath: string;
  /** Basename without the `.md` extension. */
  readonly slug: string;
  /** First non-empty line of the cleaned entry, for the tree preview. */
  readonly preview: string;
  /** The candidate entry with proposal-metadata lines stripped. */
  readonly entry: string;
}

/** A line that is entirely an HTML comment, e.g. `<!-- proposal: ... -->`. */
const COMMENT_LINE = /^\s*<!--.*-->\s*$/;
/** A justification line, with or without a leading bullet/quote marker. */
const JUSTIFICATION_LINE = /^\s*(?:[-*>]\s*)?justification\s*:/i;

function stripBom(s: string): string {
  return s.replace(/^﻿/, "");
}

/** Drop leading and trailing blank lines from an array of lines, in place-safe copy. */
function trimBlankEnds(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") {
    start++;
  }
  while (end > start && lines[end - 1].trim() === "") {
    end--;
  }
  return lines.slice(start, end);
}

/**
 * Extract the durable entry from a proposal file's raw content: drop whole-line
 * HTML comments and any justification-labelled line, then trim surrounding blank
 * lines. Internal formatting of the entry itself (bullets, blank lines between
 * facts) is preserved.
 */
export function stripProposalMetadata(content: string): string {
  const lines = stripBom(content).split(/\r?\n/);
  const kept = lines.filter(
    (line) => !COMMENT_LINE.test(line) && !JUSTIFICATION_LINE.test(line),
  );
  return trimBlankEnds(kept).join("\n");
}

/** First non-empty line of a block, trimmed — the tree node preview text. */
function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== "") {
      return trimmed;
    }
  }
  return "";
}

/**
 * Enumerate `.pending/*.md` proposals, sorted by slug. A missing directory (or
 * one holding only `.gitkeep`) yields an empty list — never an error. Unreadable
 * files are skipped.
 */
export async function loadPendingProposals(
  pendingDir: string,
): Promise<PendingProposal[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(pendingDir);
  } catch {
    return [];
  }
  const mdFiles = entries.filter((f) => f.toLowerCase().endsWith(".md"));
  const proposals: PendingProposal[] = [];
  for (const file of mdFiles) {
    const filePath = path.join(pendingDir, file);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const entry = stripProposalMetadata(content);
      proposals.push({
        filePath,
        slug: file.replace(/\.md$/i, ""),
        preview: firstLine(entry),
        entry,
      });
    } catch {
      // Unreadable proposal — skip rather than failing the whole load.
    }
  }
  proposals.sort((a, b) => a.slug.localeCompare(b.slug));
  return proposals;
}

/** Result of computing an append into a memory file (before it is written). */
export interface AppendResult {
  /** The full new file content, with a recomputed `used` header. */
  readonly content: string;
  /** Character count charged against the budget after the append. */
  readonly used: number;
  /** The file's declared budget. */
  readonly budget: number;
  /** True when {@link used} exceeds {@link budget} (a warning, not a hard block). */
  readonly exceedsBudget: boolean;
}

/**
 * Append `entry` to existing memory-file `content` as a new `---`-separated
 * entry, recomputing the `used` header. The declared budget in `content` wins;
 * `defaultBudget` applies only when the file has no header (or does not exist).
 * Pure — computes the new content and budget verdict without touching disk.
 */
export function appendEntryToMemory(
  existing: string,
  entry: string,
  defaultBudget: number,
): AppendResult {
  const { budget, entries } = parseMemory(existing, defaultBudget);
  const cleaned = entry.replace(/^\n+|\n+$/g, "").replace(/\s+$/, "");
  const next = [...entries, cleaned].filter((e) => e.trim() !== "");
  const used = computeUsed(next);
  return {
    content: serializeMemory(budget, next),
    used,
    budget,
    exceedsBudget: used > budget,
  };
}

/** Outcome of an approval attempt. */
export interface ApprovalResult {
  /** True when the entry was appended and the proposal deleted. */
  readonly appended: boolean;
  /** True when the append would exceed budget (and `force` was not set). */
  readonly exceedsBudget: boolean;
  /** True when the proposal had no durable content to append. */
  readonly empty: boolean;
  readonly used: number;
  readonly budget: number;
}

/**
 * Approve a proposal: read it, strip metadata, append the entry to `team.md`
 * (recomputing `used`), then delete the proposal file. When the append would
 * exceed budget and `force` is false, writes nothing and returns
 * `exceedsBudget: true` so the caller can confirm and retry with `force`. When
 * the proposal is empty after stripping, writes nothing and returns `empty`.
 * Re-reads the proposal from disk (never trusts a cached tree node) for safety.
 */
export async function approveProposal(
  pendingFilePath: string,
  teamMemoryPath: string,
  defaultBudget: number,
  force = false,
): Promise<ApprovalResult> {
  const entry = stripProposalMetadata(
    await fs.readFile(pendingFilePath, "utf8"),
  );
  if (entry.trim() === "") {
    return {
      appended: false,
      exceedsBudget: false,
      empty: true,
      used: 0,
      budget: defaultBudget,
    };
  }
  let existing = "";
  try {
    existing = await fs.readFile(teamMemoryPath, "utf8");
  } catch {
    existing = "";
  }
  const result = appendEntryToMemory(existing, entry, defaultBudget);
  if (result.exceedsBudget && !force) {
    return {
      appended: false,
      exceedsBudget: true,
      empty: false,
      used: result.used,
      budget: result.budget,
    };
  }
  await fs.mkdir(path.dirname(teamMemoryPath), { recursive: true });
  await fs.writeFile(teamMemoryPath, result.content, "utf8");
  await fs.rm(pendingFilePath, { force: true });
  return {
    appended: true,
    exceedsBudget: result.exceedsBudget,
    empty: false,
    used: result.used,
    budget: result.budget,
  };
}

/** Reject a proposal: delete the pending file. */
export async function rejectProposal(pendingFilePath: string): Promise<void> {
  await fs.rm(pendingFilePath, { force: true });
}
