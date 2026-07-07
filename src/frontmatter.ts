/**
 * Lossless-enough round-trip parsing of `---`-fenced YAML frontmatter + body.
 *
 * The tree view only needs to *read* a few scalar keys (see `agentStore.ts`),
 * but the form-editing feature must *write* files back without destroying keys
 * the form does not surface. This module preserves:
 *   - every top-level `key: value` scalar line (known and unknown), and
 *   - the original key order, and
 *   - the markdown body verbatim.
 *
 * It is deliberately minimal — it understands only flat `key: value` scalars,
 * which is all the harness agent/skill files use. Nested YAML is not supported
 * and would be flattened; the harness convention avoids it. Pure Node-free /
 * `vscode`-free so it stays unit-testable.
 */

export interface ParsedDocument {
  /** Flat map of frontmatter keys to their raw string values. */
  readonly frontmatter: Record<string, string>;
  /** Keys in their original file order (used to re-serialize stably). */
  readonly keyOrder: string[];
  /** Everything after the closing fence, verbatim (leading blank line trimmed).
   * Mutable so the save flow can replace it before re-serializing. */
  body: string;
  /** Whether a well-formed frontmatter block was found. */
  readonly hasFrontmatter: boolean;
}

/** Strip a leading UTF-8 BOM if present. */
function stripBom(s: string): string {
  return s.replace(/^﻿/, "");
}

export function parseDocument(content: string): ParsedDocument {
  const normalized = stripBom(content);
  const lines = normalized.split(/\r?\n/);

  let start = 0;
  while (start < lines.length && lines[start].trim() === "") {
    start++;
  }
  if (start >= lines.length || lines[start].trim() !== "---") {
    return {
      frontmatter: {},
      keyOrder: [],
      body: normalized,
      hasFrontmatter: false,
    };
  }

  const frontmatter: Record<string, string> = {};
  const keyOrder: string[] = [];
  let closingIndex = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closingIndex = i;
      break;
    }
    const line = lines[i];
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key && !(key in frontmatter)) {
      keyOrder.push(key);
    }
    if (key) {
      frontmatter[key] = value;
    }
  }

  if (closingIndex === -1) {
    // No closing fence — not valid frontmatter; treat the whole thing as body.
    return {
      frontmatter: {},
      keyOrder: [],
      body: normalized,
      hasFrontmatter: false,
    };
  }

  let bodyLines = lines.slice(closingIndex + 1);
  // Drop a single blank line that conventionally follows the closing fence.
  if (bodyLines.length > 0 && bodyLines[0].trim() === "") {
    bodyLines = bodyLines.slice(1);
  }
  return {
    frontmatter,
    keyOrder,
    body: bodyLines.join("\n"),
    hasFrontmatter: true,
  };
}

/**
 * Set (or, when `value` is empty/undefined, remove) a frontmatter key in place,
 * maintaining {@link ParsedDocument.keyOrder}. New keys are appended.
 */
export function setKey(
  doc: ParsedDocument,
  key: string,
  value: string | undefined,
): void {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") {
    delete doc.frontmatter[key];
    const idx = doc.keyOrder.indexOf(key);
    if (idx !== -1) {
      doc.keyOrder.splice(idx, 1);
    }
    return;
  }
  if (!(key in doc.frontmatter)) {
    doc.keyOrder.push(key);
  }
  doc.frontmatter[key] = trimmed;
}

/**
 * Serialize a document back to `---`-fenced frontmatter + body. Keys are emitted
 * in {@link ParsedDocument.keyOrder}; the body is written verbatim with a single
 * trailing newline. When there are no frontmatter keys, only the body is emitted.
 */
export function serializeDocument(doc: ParsedDocument): string {
  const body = doc.body.replace(/\s+$/, "");
  const keys = doc.keyOrder.filter((k) => k in doc.frontmatter);
  if (keys.length === 0) {
    return body + "\n";
  }
  const front = keys.map((k) => `${k}: ${doc.frontmatter[k]}`).join("\n");
  return `---\n${front}\n---\n\n${body}\n`;
}
