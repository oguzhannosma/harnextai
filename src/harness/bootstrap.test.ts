import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { bootstrapHarness } from "./bootstrap";
import { hasHarness, loadHarnessConfig } from "./project";

test("bootstrapHarness creates skeleton and harness.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-bootstrap-"));
  try {
    const result = await bootstrapHarness(root);
    assert.ok(hasHarness(root));
    assert.ok(result.created.includes(".harness/harness.json"));
    assert.ok(
      existsSync(join(root, ".harness", "protocol", "memory-protocol.md")),
    );
    const config = await loadHarnessConfig(root);
    assert.equal(config.version, 1);
    assert.deepEqual(config.agents, []);
    assert.ok(config.workflow);
    assert.equal(typeof config.workflow.trigger, "string");
    assert.ok(Array.isArray(config.workflow.steps));
    assert.ok(config.workflow.steps.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrapHarness is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-bootstrap-"));
  try {
    const first = await bootstrapHarness(root);
    const second = await bootstrapHarness(root);
    assert.ok(first.created.length > 0);
    assert.equal(second.created.length, 0);
    assert.ok(second.skipped.includes(".harness/harness.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrapHarness copies architect skill when source provided", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-bootstrap-"));
  const skillRoot = await mkdtemp(join(tmpdir(), "harness-skill-"));
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const srcDir = join(skillRoot, "harness-architect");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "SKILL.md"), "# Architect\n", "utf8");

    const result = await bootstrapHarness(root, {
      architectSkillSourceDir: srcDir,
    });
    assert.ok(result.created.includes(".harness/skills/harness-architect/"));
    assert.ok(
      existsSync(
        join(root, ".harness", "skills", "harness-architect", "SKILL.md"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(skillRoot, { recursive: true, force: true });
  }
});
