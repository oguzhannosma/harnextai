import { test } from "node:test";
import * as assert from "node:assert/strict";
import { isFilePathRef, BARE_FILE_PATH_RE } from "./filePaths";

test("isFilePathRef accepts relative and harness paths", () => {
  assert.equal(isFilePathRef(".harness/agents/developer.md"), true);
  assert.equal(isFilePathRef("src/extension.ts"), true);
  assert.equal(isFilePathRef("./foo/bar.ts"), true);
  assert.equal(isFilePathRef("docs/research/note.md"), true);
  assert.equal(isFilePathRef(".claude/skills/x/SKILL.md"), true);
});

test("isFilePathRef rejects external URLs and anchors", () => {
  assert.equal(isFilePathRef("https://example.com/foo"), false);
  assert.equal(isFilePathRef("http://example.com"), false);
  assert.equal(isFilePathRef("mailto:a@b.com"), false);
  assert.equal(isFilePathRef("#section"), false);
  assert.equal(isFilePathRef("vscode://file/x"), false);
});

test("isFilePathRef accepts extension-only filenames", () => {
  assert.equal(isFilePathRef("package.json"), true);
  assert.equal(isFilePathRef("README.md"), true);
});

test("BARE_FILE_PATH_RE finds paths in prose", () => {
  const text =
    "See src/formPanel.ts and `.harness/protocol/memory-protocol.md` plus docs/a.md.";
  const hits = [...text.matchAll(BARE_FILE_PATH_RE)].map((m) => m[0]);
  assert.ok(hits.includes("src/formPanel.ts"));
  assert.ok(hits.includes(".harness/protocol/memory-protocol.md"));
  assert.ok(hits.includes("docs/a.md"));
});
