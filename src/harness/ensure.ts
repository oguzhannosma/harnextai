import { generateAgentStub, generateCommandStub } from "./stubs";
import { agentNames, hasHarness, loadHarnessConfig } from "./project";
import { bootstrapHarness, type BootstrapResult } from "./bootstrap";
import { installHarnessHooks } from "./initHooks";
import { knownAdapter } from "./adapters";
import { listCommandNames } from "./stubs";
import { copySkillToTool, listSkills } from "./skills";

export interface EnsureHarnessResult {
  bootstrapped: boolean;
  bootstrap?: BootstrapResult;
  hooksInstalled: string[];
}

export interface EnsureHarnessOptions {
  tools?: string[];
  architectSkillSourceDir?: string;
}

/**
 * Ensure `.harness/harness.json` exists; bootstrap + install hooks when missing.
 */
export async function ensureHarness(
  repoRoot: string,
  options: EnsureHarnessOptions = {},
): Promise<EnsureHarnessResult> {
  if (hasHarness(repoRoot)) {
    return { bootstrapped: false, hooksInstalled: [] };
  }
  const bootstrap = await bootstrapHarness(repoRoot, {
    tools: options.tools,
    architectSkillSourceDir: options.architectSkillSourceDir,
  });
  const hooks = await installHarnessHooks(repoRoot);
  return {
    bootstrapped: true,
    bootstrap,
    hooksInstalled: hooks.installed,
  };
}

/** Regenerate all stubs and skill copies for enabled tools. */
export async function regenerateAllStubs(repoRoot: string): Promise<string[]> {
  const config = await loadHarnessConfig(repoRoot);
  const actions: string[] = [];
  const adapters = Object.entries(config.tools)
    .filter(([, on]) => on)
    .map(([id]) => knownAdapter(id))
    .filter((a) => a !== undefined);

  const commandNames = await listCommandNames(repoRoot);
  for (const adapter of adapters) {
    for (const name of agentNames(config)) {
      const r = await generateAgentStub(repoRoot, adapter, name);
      if (r?.action === "written") {
        actions.push(`regenerated ${adapter.agentsDir}/${name}.md`);
      }
    }
    for (const name of commandNames) {
      const r = await generateCommandStub(repoRoot, adapter, name);
      if (r?.action === "written") {
        actions.push(`regenerated ${adapter.commandsDir}/${name}.md`);
      }
    }
    for (const skill of await listSkills(repoRoot)) {
      await copySkillToTool(repoRoot, adapter, skill.name);
      actions.push(`copied skill ${skill.name} → ${adapter.skillsDir}/`);
    }
  }
  return actions;
}
