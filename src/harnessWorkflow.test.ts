import { test } from "node:test";
import * as assert from "node:assert/strict";
import { isGateStep, parseHarnessWorkflow } from "./harnessWorkflow";

const SAMPLE = JSON.stringify({
  version: 1,
  workflow: {
    trigger: "user gives a ticket number",
    steps: [
      { step: "researcher", action: "investigates the ticket" },
      { step: "user-gate", action: "user reads findings" },
      { step: "developer", action: "implements" },
      { step: "developer", action: "pushes and opens PR" },
    ],
  },
});

test("parseHarnessWorkflow reads trigger and steps in order", () => {
  const result = parseHarnessWorkflow(SAMPLE);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.workflow.trigger, "user gives a ticket number");
  assert.equal(result.workflow.steps.length, 4);
  assert.equal(result.workflow.steps[0].step, "researcher");
  assert.equal(result.workflow.steps[3].step, "developer");
  assert.equal(result.workflow.steps[3].action, "pushes and opens PR");
});

test("parseHarnessWorkflow preserves duplicate step ids", () => {
  const result = parseHarnessWorkflow(SAMPLE);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const devs = result.workflow.steps.filter((s) => s.step === "developer");
  assert.equal(devs.length, 2);
});

test("parseHarnessWorkflow rejects missing workflow block", () => {
  const result = parseHarnessWorkflow(JSON.stringify({ version: 1 }));
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.match(result.error, /no workflow block/);
});

test("parseHarnessWorkflow rejects invalid JSON", () => {
  const result = parseHarnessWorkflow("{ not json");
  assert.equal(result.ok, false);
});

test("parseHarnessWorkflow rejects empty steps array", () => {
  const result = parseHarnessWorkflow(
    JSON.stringify({ workflow: { trigger: "x", steps: [] } }),
  );
  assert.equal(result.ok, false);
});

test("parseHarnessWorkflow rejects step entries missing action", () => {
  const result = parseHarnessWorkflow(
    JSON.stringify({
      workflow: { trigger: "x", steps: [{ step: "researcher" }] },
    }),
  );
  assert.equal(result.ok, false);
});

test("isGateStep identifies user gates", () => {
  assert.equal(isGateStep("user-gate"), true);
  assert.equal(isGateStep("user"), true);
  assert.equal(isGateStep("developer"), false);
});
