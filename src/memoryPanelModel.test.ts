import { test } from "node:test";
import * as assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildSection, loadMemoryPanel } from "./memoryPanelModel";

test("buildSection parses budget header and entries, under budget", () => {
  const content = `<!-- budget: 2200 | used: 0 -->\n- first entry\n---\n- second entry\n`;
  const section = buildSection("agent.md", "/x/agent.md", content, 2200);
  assert.equal(section.label, "agent.md");
  assert.equal(section.budget, 2200);
  assert.deepEqual(section.entries, ["- first entry", "- second entry"]);
  // used = joined-with-separator length.
  assert.equal(
    section.used,
    ["- first entry", "- second entry"].join("\n---\n").length,
  );
  assert.equal(section.overBudget, false);
});

test("buildSection flags over-budget when used exceeds budget", () => {
  const big = "x".repeat(50);
  const content = `<!-- budget: 10 | used: 0 -->\n${big}\n`;
  const section = buildSection("team.md", "/x/team.md", content, 4000);
  assert.equal(section.budget, 10);
  assert.equal(section.used, 50);
  assert.equal(section.overBudget, true);
});

test("buildSection falls back to defaultBudget when header missing", () => {
  const section = buildSection("m.md", "/x/m.md", "- lone entry\n", 2200);
  assert.equal(section.budget, 2200);
  assert.deepEqual(section.entries, ["- lone entry"]);
});

test("loadMemoryPanel assembles sections from fixture files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mempanel-"));
  const memoriesDir = path.join(dir, "memories");
  const teamDir = path.join(dir, "team-memories");
  await fs.mkdir(memoriesDir, { recursive: true });
  await fs.mkdir(teamDir, { recursive: true });
  const teamPath = path.join(teamDir, "team.md");
  await fs.writeFile(
    path.join(memoriesDir, "alpha.md"),
    `<!-- budget: 100 | used: 0 -->\n- a note\n`,
    "utf8",
  );
  await fs.writeFile(
    teamPath,
    `<!-- budget: 4000 | used: 0 -->\n- shared note\n`,
    "utf8",
  );

  const view = await loadMemoryPanel(memoriesDir, teamPath);
  // personal alpha.md, then the team file (loadMemoryFiles appends team last).
  assert.equal(view.sections.length, 2);
  assert.equal(view.sections[0].label, "alpha.md");
  assert.deepEqual(view.sections[0].entries, ["- a note"]);
  assert.ok(view.sections[1].label.includes("team.md"));
  assert.deepEqual(view.sections[1].entries, ["- shared note"]);

  await fs.rm(dir, { recursive: true, force: true });
});

test("loadMemoryPanel tolerates a missing memories dir", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mempanel-empty-"));
  const view = await loadMemoryPanel(
    path.join(dir, "does-not-exist"),
    path.join(dir, "no-team.md"),
  );
  assert.deepEqual(view.sections, []);
  await fs.rm(dir, { recursive: true, force: true });
});
