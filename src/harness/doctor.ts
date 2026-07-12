import { existsSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentNames, loadHarnessConfig } from "./project";
import { knownAdapter, type ToolAdapter } from "./adapters";
import {
  buildAgentStubContent,
  buildCommandStubContent,
  generateAgentStub,
  generateCommandStub,
  deleteAgentStub,
  deleteCommandStub,
  listAgentSourceNames,
  listCommandNames,
  bannerStubNames,
} from "./stubs";
import { listSkills, copySkillToTool } from "./skills";
import { git } from "./git";
import { hasValidHeader, parseMemoryFile, serializeMemoryFile } from "./memory";
import { listMdNames, readText } from "./fsUtil";

export interface DoctorFinding {
  severity: "error" | "warn" | "info";
  category: string;
  message: string;
  fixable: boolean;
}

const STALENESS_THRESHOLD = 25;

async function adaptersFor(root: string): Promise<ToolAdapter[]> {
  const config = await loadHarnessConfig(root);
  return Object.entries(config.tools)
    .filter(([, enabled]) => enabled)
    .map(([tool]) => knownAdapter(tool))
    .filter((a): a is ToolAdapter => a !== undefined);
}

async function listMemoryFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  if (existsSync(join(root, ".harness", "team-memories", "team.md"))) {
    files.push(".harness/team-memories/team.md");
  }
  const personalDir = join(root, ".harness", "memories");
  if (existsSync(personalDir)) {
    for (const name of await listMdNames(personalDir)) {
      if (name !== "README") {
        files.push(`.harness/memories/${name}.md`);
      }
    }
  }
  return files;
}

export async function runDoctorChecks(root: string): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  const config = await loadHarnessConfig(root);
  const configAgents = agentNames(config);
  const adapters = await adaptersFor(root);
  const sourceAgents = await listAgentSourceNames(root);
  const commandNames = await listCommandNames(root);

  for (const name of configAgents) {
    if (!sourceAgents.includes(name)) {
      findings.push({
        severity: "error",
        category: "config",
        message: `agent "${name}" is listed in harness.json but .harness/agents/${name}.md does not exist`,
        fixable: false,
      });
    }
  }
  for (const name of sourceAgents) {
    if (!configAgents.includes(name)) {
      findings.push({
        severity: "warn",
        category: "config",
        message: `.harness/agents/${name}.md exists but "${name}" is not listed in harness.json — no stubs are generated for it`,
        fixable: false,
      });
    }
  }

  for (const adapter of adapters) {
    for (const name of configAgents) {
      const expected = await buildAgentStubContent(root, adapter, name);
      if (expected === null) {
        continue;
      }
      const stubPath = join(root, adapter.agentsDir, `${name}.md`);
      if (!existsSync(stubPath)) {
        findings.push({
          severity: "warn",
          category: "stub-drift",
          message: `${adapter.agentsDir}/${name}.md is missing — Fix all in Doctor to generate it`,
          fixable: true,
        });
      } else if ((await readText(stubPath)) !== expected) {
        findings.push({
          severity: "warn",
          category: "stub-drift",
          message: `${adapter.agentsDir}/${name}.md differs from what .harness/agents/${name}.md would generate`,
          fixable: true,
        });
      }
    }
    for (const name of commandNames) {
      const expected = await buildCommandStubContent(root, name);
      if (expected === null) {
        continue;
      }
      const stubPath = join(root, adapter.commandsDir, `${name}.md`);
      if (!existsSync(stubPath)) {
        findings.push({
          severity: "warn",
          category: "stub-drift",
          message: `${adapter.commandsDir}/${name}.md is missing — Fix all in Doctor to generate it`,
          fixable: true,
        });
      } else if ((await readText(stubPath)) !== expected) {
        findings.push({
          severity: "warn",
          category: "stub-drift",
          message: `${adapter.commandsDir}/${name}.md differs from what .harness/commands/${name}.md would generate`,
          fixable: true,
        });
      }
    }

    for (const name of await bannerStubNames(root, adapter.agentsDir)) {
      if (!existsSync(join(root, ".harness", "agents", `${name}.md`))) {
        findings.push({
          severity: "warn",
          category: "orphan",
          message: `${adapter.agentsDir}/${name}.md is a generated stub whose source .harness/agents/${name}.md is gone`,
          fixable: true,
        });
      }
    }
    for (const name of await bannerStubNames(root, adapter.commandsDir)) {
      if (!existsSync(join(root, ".harness", "commands", `${name}.md`))) {
        findings.push({
          severity: "warn",
          category: "orphan",
          message: `${adapter.commandsDir}/${name}.md is a generated stub whose source .harness/commands/${name}.md is gone`,
          fixable: true,
        });
      }
    }

    for (const dir of [adapter.agentsDir, adapter.commandsDir]) {
      const abs = join(root, dir);
      if (!existsSync(abs)) {
        continue;
      }
      const files = await readdir(abs);
      for (const file of files) {
        if (!file.endsWith(".md")) {
          continue;
        }
        const content = await readText(join(abs, file));
        for (const m of content.matchAll(/@(\.harness\/[^\s)`"']+)/g)) {
          if (!existsSync(join(root, m[1]!))) {
            findings.push({
              severity: "error",
              category: "broken-ref",
              message: `${dir}/${file} references @${m[1]} which does not exist`,
              fixable: false,
            });
          }
        }
      }
    }
  }

  for (const skill of await listSkills(root)) {
    const srcContent = await readText(
      join(root, ".harness", "skills", skill.name, "SKILL.md"),
    );
    for (const adapter of adapters) {
      const copyPath = join(root, adapter.skillsDir, skill.name, "SKILL.md");
      if (!existsSync(copyPath)) {
        findings.push({
          severity: "warn",
          category: "skill-copy",
          message: `${adapter.skillsDir}/${skill.name}/ is missing its copy of skill "${skill.name}"`,
          fixable: true,
        });
      } else if ((await readText(copyPath)) !== srcContent) {
        findings.push({
          severity: "warn",
          category: "skill-copy",
          message: `${adapter.skillsDir}/${skill.name}/SKILL.md differs from .harness/skills/${skill.name}/SKILL.md`,
          fixable: true,
        });
      }
    }
  }

  for (const rel of await listMemoryFiles(root)) {
    const raw = await readText(join(root, rel));
    if (!hasValidHeader(raw)) {
      findings.push({
        severity: "error",
        category: "memory",
        message: `${rel} has no valid \`<!-- budget: N | used: N -->\` header on line 1 — agents can't track its budget`,
        fixable: true,
      });
      continue;
    }
    const mem = parseMemoryFile(raw);
    const actual = mem.entries.join("\n---\n").length;
    if (mem.used !== actual) {
      findings.push({
        severity: "warn",
        category: "memory",
        message: `${rel} header says used: ${mem.used} but entries total ${actual} chars — the header is stale`,
        fixable: true,
      });
    }
    if (actual > mem.budget) {
      findings.push({
        severity: "error",
        category: "memory",
        message: `${rel} is ${actual} chars, over its ${mem.budget}-char budget — consolidate entries per the memory protocol`,
        fixable: false,
      });
    }
  }

  const markerPath = join(root, ".harness", "last-index-commit");
  if (!existsSync(join(root, ".git"))) {
    // skip staleness
  } else if (!existsSync(markerPath)) {
    findings.push({
      severity: "info",
      category: "index-staleness",
      message:
        "no .harness/last-index-commit marker — the indexer has not recorded a full run yet",
      fixable: false,
    });
  } else {
    const marker = (await readText(markerPath)).trim();
    const known = await git(root, "cat-file", "-e", marker);
    if (known.code === 127) {
      // git unavailable
    } else if (known.code !== 0) {
      findings.push({
        severity: "warn",
        category: "index-staleness",
        message: `last-index-commit ${marker.slice(0, 8)} is unknown in this repo — consider reindexing`,
        fixable: false,
      });
    } else {
      const diff = await git(root, "diff", "--name-only", `${marker}..HEAD`);
      if (diff.code === 0) {
        const changed = diff.out.split("\n").filter(Boolean).length;
        if (changed >= STALENESS_THRESHOLD) {
          findings.push({
            severity: "warn",
            category: "index-staleness",
            message: `${changed} files changed since the last indexed commit (threshold ${STALENESS_THRESHOLD}) — the project index is likely stale`,
            fixable: false,
          });
        }
      }
    }
  }

  return findings;
}

export async function applyDoctorFixes(root: string): Promise<string[]> {
  const actions: string[] = [];
  const config = await loadHarnessConfig(root);
  const adapters = await adaptersFor(root);
  const commandNames = await listCommandNames(root);

  for (const adapter of adapters) {
    for (const name of agentNames(config)) {
      const result = await generateAgentStub(root, adapter, name);
      if (result?.action === "written") {
        actions.push(`regenerated ${adapter.agentsDir}/${name}.md`);
      }
    }
    for (const name of commandNames) {
      const result = await generateCommandStub(root, adapter, name);
      if (result?.action === "written") {
        actions.push(`regenerated ${adapter.commandsDir}/${name}.md`);
      }
    }
    for (const name of await bannerStubNames(root, adapter.agentsDir)) {
      if (!existsSync(join(root, ".harness", "agents", `${name}.md`))) {
        if (await deleteAgentStub(root, adapter, name)) {
          actions.push(`deleted orphan ${adapter.agentsDir}/${name}.md`);
        }
      }
    }
    for (const name of await bannerStubNames(root, adapter.commandsDir)) {
      if (!existsSync(join(root, ".harness", "commands", `${name}.md`))) {
        if (await deleteCommandStub(root, adapter, name)) {
          actions.push(`deleted orphan ${adapter.commandsDir}/${name}.md`);
        }
      }
    }
    for (const skill of await listSkills(root)) {
      const copyPath = join(root, adapter.skillsDir, skill.name, "SKILL.md");
      const srcContent = await readText(
        join(root, ".harness", "skills", skill.name, "SKILL.md"),
      );
      if (!existsSync(copyPath) || (await readText(copyPath)) !== srcContent) {
        await copySkillToTool(root, adapter, skill.name);
        actions.push(`re-copied skill ${skill.name} → ${adapter.skillsDir}/`);
      }
    }
  }

  for (const rel of await listMemoryFiles(root)) {
    const abs = join(root, rel);
    const raw = await readText(abs);
    const mem = parseMemoryFile(raw);
    const actual = mem.entries.join("\n---\n").length;
    if (!hasValidHeader(raw) || mem.used !== actual) {
      if (!hasValidHeader(raw)) {
        mem.budget = rel.includes("team-memories")
          ? (config.settings?.teamMemoryBudget ?? 4000)
          : (config.settings?.personalMemoryBudget ?? 2200);
      }
      await writeFile(abs, serializeMemoryFile(mem), "utf8");
      actions.push(`rewrote memory header of ${rel} (used: ${actual})`);
    }
  }
  return actions;
}
