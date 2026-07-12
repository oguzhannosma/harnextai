import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  ExecFn,
  GH_ISSUE_LIST_ARGS,
  listOpenIssues,
  parseIssues,
} from "./githubIssues";

// --- parseIssues ------------------------------------------------------------

test("parseIssues maps number/title/url/state and flattens label names", () => {
  const stdout = JSON.stringify([
    {
      number: 42,
      title: "Add search API",
      url: "https://github.com/o/r/issues/42",
      state: "OPEN",
      labels: [{ name: "enhancement" }, { name: "backend" }],
    },
  ]);
  assert.deepEqual(parseIssues(stdout), [
    {
      number: 42,
      title: "Add search API",
      url: "https://github.com/o/r/issues/42",
      state: "OPEN",
      labels: ["enhancement", "backend"],
    },
  ]);
});

test("parseIssues returns [] for empty, blank, or non-array output", () => {
  assert.deepEqual(parseIssues(""), []);
  assert.deepEqual(parseIssues("   \n"), []);
  assert.deepEqual(parseIssues("{}"), []);
  assert.deepEqual(parseIssues("not json"), []);
});

test("parseIssues skips entries without a numeric number and tolerates missing fields", () => {
  const stdout = JSON.stringify([
    { title: "no number" },
    { number: 7 },
    { number: "8", title: "string number" },
  ]);
  assert.deepEqual(parseIssues(stdout), [
    { number: 7, title: "", url: "", state: "", labels: [] },
  ]);
});

test("parseIssues ignores malformed labels without crashing", () => {
  const stdout = JSON.stringify([
    { number: 1, title: "t", labels: [{ nope: 1 }, "x", { name: "keep" }] },
  ]);
  assert.deepEqual(parseIssues(stdout)[0].labels, ["keep"]);
});

// --- listOpenIssues (injected exec) -----------------------------------------

test("listOpenIssues calls gh with the JSON list args and parses stdout", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const fakeExec: ExecFn = async (command, args) => {
    calls.push({ command, args });
    return {
      stdout: JSON.stringify([{ number: 3, title: "Fix bug", labels: [] }]),
    };
  };

  const issues = await listOpenIssues(fakeExec);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "gh");
  assert.deepEqual(calls[0].args, GH_ISSUE_LIST_ARGS);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].number, 3);
  assert.equal(issues[0].title, "Fix bug");
});

test("listOpenIssues propagates a failing gh invocation", async () => {
  const fakeExec: ExecFn = async () => {
    throw new Error("gh: not authenticated");
  };
  await assert.rejects(() => listOpenIssues(fakeExec), /not authenticated/);
});
