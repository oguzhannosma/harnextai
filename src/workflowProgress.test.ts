import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  parseWorkflowProgress,
  formatProgressMarkdown,
} from "./workflowProgress";

const VALID = `---
issue: 42
step: researcher
stepIndex: 0
status: active
updatedAt: 2026-07-12T12:00:00Z
---

Findings in progress.
`;

test("parseWorkflowProgress reads required fields and note body", () => {
  const r = parseWorkflowProgress(VALID);
  assert.equal(r.ok, true);
  if (!r.ok) {
    return;
  }
  assert.equal(r.progress.issue, 42);
  assert.equal(r.progress.step, "researcher");
  assert.equal(r.progress.stepIndex, 0);
  assert.equal(r.progress.status, "active");
  assert.equal(r.progress.updatedAt, "2026-07-12T12:00:00Z");
  assert.equal(r.progress.note, "Findings in progress.");
});

test("parseWorkflowProgress accepts waiting-user and done", () => {
  const waiting = parseWorkflowProgress(
    `---\nissue: 1\nstep: user-gate\nstepIndex: 1\nstatus: waiting-user\n---\n`,
  );
  assert.equal(waiting.ok, true);
  if (waiting.ok) {
    assert.equal(waiting.progress.status, "waiting-user");
  }
  const done = parseWorkflowProgress(
    `---\nissue: 1\nstep: user\nstepIndex: 10\nstatus: done\n---\n`,
  );
  assert.equal(done.ok, true);
  if (done.ok) {
    assert.equal(done.progress.status, "done");
  }
});

test("parseWorkflowProgress rejects missing frontmatter", () => {
  const r = parseWorkflowProgress("no frontmatter here");
  assert.equal(r.ok, false);
});

test("parseWorkflowProgress rejects invalid status and stepIndex", () => {
  assert.equal(
    parseWorkflowProgress(
      `---\nissue: 1\nstep: dev\nstepIndex: -1\nstatus: active\n---\n`,
    ).ok,
    false,
  );
  assert.equal(
    parseWorkflowProgress(
      `---\nissue: 1\nstep: dev\nstepIndex: 0\nstatus: running\n---\n`,
    ).ok,
    false,
  );
});

test("formatProgressMarkdown round-trips through parseWorkflowProgress", () => {
  const md = formatProgressMarkdown({
    issue: 7,
    step: "developer",
    stepIndex: 2,
    status: "active",
    updatedAt: "2026-07-12T10:00:00.000Z",
    note: "Building feature.",
  });
  const r = parseWorkflowProgress(md);
  assert.equal(r.ok, true);
  if (!r.ok) {
    return;
  }
  assert.equal(r.progress.issue, 7);
  assert.equal(r.progress.step, "developer");
  assert.equal(r.progress.stepIndex, 2);
  assert.equal(r.progress.note, "Building feature.");
});
