import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseDocument } from "../frontmatter";
import type { ToolAdapter } from "./adapters";
import { readText, walkFiles } from "./fsUtil";

export interface SkillInfo {
  name: string;
  description: string;
  source: string;
}

export async function listSkills(root: string): Promise<SkillInfo[]> {
  const dir = join(root, ".harness", "skills");
  if (!existsSync(dir)) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillMd = join(dir, entry.name, "SKILL.md");
    if (!existsSync(skillMd)) {
      continue;
    }
    const { frontmatter } = parseDocument(await readText(skillMd));
    skills.push({
      name: entry.name,
      description: frontmatter.description ?? "",
      source: `.harness/skills/${entry.name}/SKILL.md`,
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function copySkillToTool(
  root: string,
  adapter: ToolAdapter,
  skillName: string,
): Promise<boolean> {
  const srcDir = join(root, ".harness", "skills", skillName);
  if (!existsSync(join(srcDir, "SKILL.md"))) {
    return false;
  }

  const destDir = join(root, adapter.skillsDir, skillName);
  const files = await walkFiles(srcDir);
  for (const file of files) {
    const dest = join(destDir, file);
    await mkdir(dirname(dest), { recursive: true });
    await cp(join(srcDir, file), dest);
  }
  return true;
}

export async function deleteSkill(
  root: string,
  adapters: ToolAdapter[],
  skillName: string,
): Promise<void> {
  const srcDir = join(root, ".harness", "skills", skillName);
  if (!existsSync(srcDir)) {
    throw new Error(`No skill at .harness/skills/${skillName}`);
  }

  for (const adapter of adapters) {
    const nativeDir = join(root, adapter.skillsDir, skillName);
    if (existsSync(nativeDir)) {
      await rm(nativeDir, { recursive: true, force: true });
    }
  }
  await rm(srcDir, { recursive: true, force: true });
}
