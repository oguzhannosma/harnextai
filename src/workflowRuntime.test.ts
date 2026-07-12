import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  buildContinueCommand,
  buildRuntimeCommand,
  isWorkflowRuntime,
  issuePrompt,
  runtimeAgentName,
  runtimeCli,
} from "./workflowRuntime";

test("isWorkflowRuntime accepts only the two known runtimes", () => {
  assert.equal(isWorkflowRuntime("claude"), true);
  assert.equal(isWorkflowRuntime("cursor"), true);
  assert.equal(isWorkflowRuntime("gpt"), false);
  assert.equal(isWorkflowRuntime(undefined), false);
});

test("runtimeCli maps claude->claude and cursor->agent", () => {
  assert.equal(runtimeCli("claude"), "claude");
  assert.equal(runtimeCli("cursor"), "agent");
});

test("runtimeAgentName matches the runtime key for the branch segment", () => {
  assert.equal(runtimeAgentName("claude"), "claude");
  assert.equal(runtimeAgentName("cursor"), "cursor");
});

test("buildRuntimeCommand quotes the prompt as a single argument", () => {
  const p42 = issuePrompt(42);
  assert.ok(p42.includes("progress.md"));
  assert.equal(buildRuntimeCommand("claude", p42), `claude "${p42}"`);
  const p7 = issuePrompt(7);
  assert.equal(buildRuntimeCommand("cursor", p7), `agent "${p7}"`);
});

test("buildContinueCommand matches each runtime", () => {
  assert.equal(buildContinueCommand("claude"), "claude --continue");
  assert.equal(buildContinueCommand("cursor"), "agent");
});
