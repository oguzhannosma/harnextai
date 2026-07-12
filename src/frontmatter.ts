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
 * It is deliberately minimal: it understands flat `key: value` scalars plus
 * block scalars (`|`, `|-`, `|+`, `>`, `>-`, `>+`) so multiline `description`
 * fields survive a read/edit/write round-trip as real text instead of the
 * literal indicator (`">-"`). Nested YAML is not supported and would be
 * flattened; the harness convention avoids it. Pure Node-free / `vscode`-free
 * so it stays unit-testable.
 */

export interface ParsedDocument {
  /** Flat map of frontmatter keys to their resolved string values. Block
   * scalars are resolved to their real (multiline / folded) text. */
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
  return s.replace(/^\uFEFF/, "");
}

interface BlockHeader {
  style: "|" | ">";
  /** `-` = strip, `+` = keep, `""` = clip (default). */
  chomp: "-" | "+" | "";
}

/**
 * Recognize a YAML block scalar header (the text after `key:`), e.g. `>-`,
 * `|`, `|+`, `> # comment`. Explicit indentation indicators are tolerated but
 * ignored in favour of auto-detecting the block's indentation. Returns `null`
 * for anything that is not a block scalar so it is treated as an inline value.
 */
function parseBlockHeader(value: string): BlockHeader | null {
  const style = value[0];
  if (style !== "|" && style !== ">") {
    return null;
  }
  // Drop a trailing `# comment` (must be whitespace-separated).
  const rest = value
    .slice(1)
    .replace(/\s+#.*$/, "")
    .trim();
  let chomp: "-" | "+" | "" = "";
  for (const ch of rest) {
    if (ch === "+" || ch === "-") {
      chomp = ch;
    } else if (ch >= "0" && ch <= "9") {
      // Explicit indentation indicator; ignored (we auto-detect instead).
    } else {
      // Unexpected char (e.g. `>foo`): not a block scalar.
      return null;
    }
  }
  return { style, chomp };
}

/**
 * Fold a block scalar's content lines the way YAML folded (`>`) style reads:
 * a single line break between non-empty lines becomes a space; blank lines
 * become newlines. Input lines are already de-indented.
 */
function foldLines(lines: string[]): string {
  let result = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0) {
      result = line;
      continue;
    }
    const prev = lines[i - 1];
    if (line === "") {
      result += "\n";
    } else if (prev === "") {
      result += line;
    } else {
      result += " " + line;
    }
  }
  return result;
}

/** Count of leading space characters. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

interface BlockResult {
  value: string;
  /** Index of the first line that is NOT part of the block. */
  nextIndex: number;
}

/**
 * Consume a block scalar's body starting at `startIndex`, given the header and
 * the indentation of the owning `key:` line. Returns the resolved value and the
 * index of the first line the caller should continue from.
 */
function readBlock(
  lines: string[],
  startIndex: number,
  keyIndent: number,
  header: BlockHeader,
): BlockResult {
  const raw: string[] = [];
  let contentIndent = -1;
  let i = startIndex;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      raw.push("");
      continue;
    }
    const indent = indentOf(line);
    if (contentIndent === -1) {
      if (indent <= keyIndent) {
        break; // no more-indented content: empty block.
      }
      contentIndent = indent;
    }
    if (indent < contentIndent) {
      break;
    }
    raw.push(line.slice(contentIndent));
  }

  // Separate trailing blank lines (they matter only for chomping).
  let trailing = 0;
  while (raw.length > 0 && raw[raw.length - 1] === "") {
    raw.pop();
    trailing++;
  }

  let value: string;
  if (raw.length === 0) {
    value = "";
  } else {
    const core = header.style === "|" ? raw.join("\n") : foldLines(raw);
    if (header.chomp === "-") {
      value = core; // strip: no trailing newline.
    } else if (header.chomp === "+") {
      value = core + "\n".repeat(trailing + 1); // keep all trailing breaks.
    } else {
      value = core + "\n"; // clip: single trailing newline.
    }
  }

  return { value, nextIndex: i };
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
    const rawValue = line.slice(colon + 1).trim();
    if (!key) {
      continue;
    }

    let value = rawValue;
    const header = rawValue === "" ? null : parseBlockHeader(rawValue);
    if (header) {
      const block = readBlock(lines, i + 1, indentOf(line), header);
      value = block.value;
      // Re-process the first non-block line (next key or closing fence).
      i = block.nextIndex - 1;
    }

    if (!(key in frontmatter)) {
      keyOrder.push(key);
    }
    frontmatter[key] = value;
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
 * Serialize a single frontmatter entry. Single-line values stay inline as
 * `key: value`. Multiline values are emitted as a block scalar: folded `>-`
 * when every logical line is non-empty (which reads back exactly), otherwise
 * literal `|-` to preserve blank lines faithfully.
 */
function serializeEntry(key: string, value: string): string {
  if (!value.includes("\n")) {
    return `${key}: ${value}`;
  }
  const logical = value.split("\n");
  if (logical.some((l) => l === "")) {
    const body = logical.map((l) => (l === "" ? "" : `  ${l}`)).join("\n");
    return `${key}: |-\n${body}`;
  }
  const body = logical.map((l) => `  ${l}`).join("\n\n");
  return `${key}: >-\n${body}`;
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
  const front = keys
    .map((k) => serializeEntry(k, doc.frontmatter[k]))
    .join("\n");
  return `---\n${front}\n---\n\n${body}\n`;
}
