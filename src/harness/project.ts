import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function harnessJsonPath(root: string): string {
  return join(root, ".harness", "harness.json");
}

export function hasHarness(root: string): boolean {
  return existsSync(harnessJsonPath(root));
}

export function tryFindProjectRoot(startDir: string): string | null {
  try {
    return findProjectRoot(startDir);
  } catch {
    return null;
  }
}

export function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(harnessJsonPath(dir))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "No .harness/harness.json found in this directory or any parent.",
      );
    }
    dir = parent;
  }
}

export interface AgentEntry {
  name: string;
  prompt?: string;
  model?: string;
  skills?: string[];
  role?: string;
}

export interface HarnessConfig {
  version: number;
  tools: Record<string, boolean>;
  agents: (string | AgentEntry)[];
  workflow?: {
    trigger: string;
    steps: { step: string; action: string }[];
  };
  settings?: {
    model?: string;
    personalMemoryBudget?: number;
    teamMemoryBudget?: number;
  };
}

export function agentNames(config: HarnessConfig): string[] {
  return config.agents
    .map((entry) => (typeof entry === "string" ? entry : entry?.name))
    .filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    );
}

export async function loadHarnessConfig(root: string): Promise<HarnessConfig> {
  const path = harnessJsonPath(root);
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return JSON.parse(await readFile(path, "utf8")) as HarnessConfig;
}

export async function saveHarnessConfig(
  root: string,
  config: HarnessConfig,
): Promise<void> {
  await writeFile(
    harnessJsonPath(root),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
}
