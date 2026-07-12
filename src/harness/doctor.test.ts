import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapHarness } from "./bootstrap";
import { runDoctorChecks, applyDoctorFixes } from "./doctor";
import { loadHarnessConfig, saveHarnessConfig } from "./project";
import { generateAgentStub } from "./stubs";
import { knownAdapter } from "./adapters";

async function scaffoldProject(root: string): Promise<void> {
  await bootstrapHarness(root);
  const config = await loadHarnessConfig(root);
  config.agents = ["reviewer"];
  await saveHarnessConfig(root, config);

  const agentsDir = join(root, ".harness", "agents");
  await mkdir(agentsDir, { recursive: true });
  await writeFile(
    join(agentsDir, "reviewer.md"),
    `---
name: reviewer
description: Reviews code changes
model: inherit
---
Review pull requests carefully.
`,
    "utf8",
  );
}

test("runDoctorChecks reports missing stub when agent exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-doctor-"));
  try {
    await scaffoldProject(root);
    const findings = await runDoctorChecks(root);
    const stubDrift = findings.filter((f) => f.category === "stub-drift");
    assert.ok(stubDrift.length > 0);
    assert.ok(stubDrift.every((f) => f.fixable));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applyDoctorFixes regenerates missing agent stub", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-doctor-"));
  try {
    await scaffoldProject(root);
    const before = await runDoctorChecks(root);
    assert.ok(before.some((f) => f.category === "stub-drift"));

    const actions = await applyDoctorFixes(root);
    assert.ok(actions.some((a) => a.includes(".claude/agents/reviewer.md")));

    const adapter = knownAdapter("claude")!;
    const result = await generateAgentStub(root, adapter, "reviewer");
    assert.equal(result?.action, "skipped (no change)");

    const after = await runDoctorChecks(root);
    assert.equal(after.filter((f) => f.category === "stub-drift").length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runDoctorChecks flags agent in config without source file", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-doctor-"));
  try {
    await bootstrapHarness(root);
    const config = await loadHarnessConfig(root);
    config.agents = ["ghost"];
    await saveHarnessConfig(root, config);

    const findings = await runDoctorChecks(root);
    assert.ok(
      findings.some(
        (f) =>
          f.severity === "error" &&
          f.category === "config" &&
          f.message.includes("ghost"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
