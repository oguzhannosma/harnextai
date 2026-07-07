import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseDocument, serializeDocument, setKey } from "./frontmatter";
import type { SkillFormData } from "./shared/messages";

/**
 * A skill parsed from a `.harness/skills/<name>/SKILL.md` file's frontmatter.
 *
 * Read-only view for the tree. Like {@link ./agentStore}, this module is pure
 * Node — it must NOT import `vscode`.
 */
export interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  /** `disable-model-invocation: true` in frontmatter, else false. */
  readonly disableModelInvocation: boolean;
  /** Absolute path to the source `SKILL.md`. */
  readonly filePath: string;
}

function truthy(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

export function parseSkillFile(
  content: string,
  filePath: string,
): SkillDefinition | undefined {
  const doc = parseDocument(content);
  const name = doc.frontmatter.name;
  if (!name) {
    return undefined;
  }
  return {
    name,
    description: doc.frontmatter.description ?? "",
    disableModelInvocation: truthy(doc.frontmatter["disable-model-invocation"]),
    filePath,
  };
}

/**
 * Load every `<skillsDir>/<name>/SKILL.md`, sorted by name. Missing directory
 * yields an empty list. Unreadable / nameless skills are skipped, never thrown.
 */
export async function loadSkills(
  skillsDir: string,
): Promise<SkillDefinition[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillDefinition[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const filePath = path.join(skillsDir, entry.name, "SKILL.md");
    try {
      const content = await fs.readFile(filePath, "utf8");
      const skill = parseSkillFile(content, filePath);
      if (skill) {
        skills.push(skill);
      }
    } catch {
      // No SKILL.md in this dir, or unreadable — skip.
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export async function readSkillForm(filePath: string): Promise<SkillFormData> {
  const content = await fs.readFile(filePath, "utf8");
  const doc = parseDocument(content);
  return {
    kind: "skill",
    filePath,
    name: doc.frontmatter.name ?? "",
    description: doc.frontmatter.description ?? "",
    disableModelInvocation: truthy(doc.frontmatter["disable-model-invocation"]),
    body: doc.body,
  };
}

/** Write edited skill form data, preserving unknown frontmatter keys/order. */
export async function writeSkillForm(
  filePath: string,
  data: SkillFormData,
): Promise<void> {
  let doc;
  try {
    doc = parseDocument(await fs.readFile(filePath, "utf8"));
  } catch {
    doc = parseDocument("");
  }
  setKey(doc, "name", data.name);
  setKey(doc, "description", data.description);
  setKey(
    doc,
    "disable-model-invocation",
    data.disableModelInvocation ? "true" : "",
  );
  doc.body = data.body;
  await fs.writeFile(filePath, serializeDocument(doc), "utf8");
}
