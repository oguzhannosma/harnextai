import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseDocument, serializeDocument, setKey } from "./frontmatter";
import type { AgentFormData } from "./shared/messages";

/**
 * A single agent parsed from a `.harness/agents/*.md` file's YAML frontmatter.
 *
 * This module is the CRM's read-only view of the harness agent roster. It must
 * NOT import `vscode` — it is pure Node so it can be unit-tested and reused off
 * the extension host.
 */
export interface AgentDefinition {
  /** `name:` from frontmatter (required). */
  readonly name: string;
  /** `description:` from frontmatter (may be empty). */
  readonly description: string;
  /** `model:` from frontmatter, if present. */
  readonly model?: string;
  /** `tools:` from frontmatter, if present (kept as the raw string). */
  readonly tools?: string;
  /** Absolute path to the source `.md` file. */
  readonly filePath: string;
}

/**
 * Parse the leading `---`-fenced YAML frontmatter block into a flat string map.
 *
 * Deliberately minimal: it only understands top-level `key: value` scalar lines,
 * which is all the harness agent files use. Values may themselves contain `:`
 * (only the first colon splits). Returns an empty object when there is no
 * frontmatter block. Tolerates CRLF and a leading BOM.
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const normalized = content.replace(/^﻿/, "");
  const lines = normalized.split(/\r?\n/);

  // The first non-empty line must be the opening fence.
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") {
    start++;
  }
  if (start >= lines.length || lines[start].trim() !== "---") {
    return {};
  }

  const result: Record<string, string> = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") {
      return result; // closing fence
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) {
      result[key] = value;
    }
  }
  // No closing fence found — treat as no valid frontmatter.
  return {};
}

/**
 * Build an {@link AgentDefinition} from a file's contents. Returns `undefined`
 * when the file has no frontmatter or no `name:` (i.e. it is not a valid agent
 * definition and should be skipped).
 */
export function parseAgentFile(
  content: string,
  filePath: string,
): AgentDefinition | undefined {
  const front = parseFrontmatter(content);
  const name = front.name;
  if (!name) {
    return undefined;
  }
  return {
    name,
    description: front.description ?? "",
    model: front.model || undefined,
    tools: front.tools || undefined,
    filePath,
  };
}

/**
 * Read and parse every `*.md` agent definition in {@link agentsDir}, sorted by
 * name. Missing directory yields an empty list (not an error) — the view simply
 * shows no agents. Files that fail to parse or lack a `name:` are skipped.
 */
export async function loadAgents(
  agentsDir: string,
): Promise<AgentDefinition[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(agentsDir);
  } catch {
    return [];
  }

  const mdFiles = entries.filter((f) => f.toLowerCase().endsWith(".md"));
  const agents: AgentDefinition[] = [];
  for (const file of mdFiles) {
    const filePath = path.join(agentsDir, file);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const agent = parseAgentFile(content, filePath);
      if (agent) {
        agents.push(agent);
      }
    } catch {
      // Unreadable file — skip it rather than failing the whole load.
    }
  }

  agents.sort((a, b) => a.name.localeCompare(b.name));
  return agents;
}

/**
 * Read an agent file into the flat {@link AgentFormData} the webview edits.
 * Unknown frontmatter keys are intentionally NOT surfaced here — they are
 * preserved by {@link writeAgentForm}, which re-reads the file on save.
 */
export async function readAgentForm(filePath: string): Promise<AgentFormData> {
  const content = await fs.readFile(filePath, "utf8");
  const doc = parseDocument(content);
  return {
    kind: "agent",
    filePath,
    name: doc.frontmatter.name ?? "",
    description: doc.frontmatter.description ?? "",
    model: doc.frontmatter.model ?? "",
    tools: doc.frontmatter.tools ?? "",
    body: doc.body,
  };
}

/**
 * Write edited agent form data back to disk, preserving any frontmatter keys the
 * form does not surface. The current on-disk file is re-parsed so unknown keys
 * and their order survive the round-trip (lossless per the interop safety rule).
 */
export async function writeAgentForm(
  filePath: string,
  data: AgentFormData,
): Promise<void> {
  let doc;
  try {
    doc = parseDocument(await fs.readFile(filePath, "utf8"));
  } catch {
    doc = parseDocument("");
  }
  setKey(doc, "name", data.name);
  setKey(doc, "description", data.description);
  setKey(doc, "model", data.model);
  setKey(doc, "tools", data.tools);
  doc.body = data.body;
  await fs.writeFile(filePath, serializeDocument(doc), "utf8");
}
