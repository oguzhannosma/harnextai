import { test } from "node:test";
import * as assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  recordToTurn,
  simplifyRecords,
  loadTranscript,
  DEFAULT_TURN_CAP,
} from "./transcript";

// --- synthetic fixtures -----------------------------------------------------

test("assistant tool_use renders as a compact ⚙ marker, no input", () => {
  const rec = {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Reading the file." },
        { type: "tool_use", name: "Read", input: { file_path: "/secret" } },
      ],
    },
  };
  const turn = recordToTurn(rec);
  assert.deepEqual(turn, {
    role: "assistant",
    parts: [
      { kind: "text", text: "Reading the file." },
      { kind: "tool", name: "Read" },
    ],
  });
});

test("meta and <-wrapped user echoes are skipped", () => {
  assert.equal(
    recordToTurn({ type: "user", isMeta: true, message: { content: "hi" } }),
    null,
  );
  assert.equal(
    recordToTurn({
      type: "user",
      message: { content: "<command-name>/model</command-name>" },
    }),
    null,
  );
  // A genuine prompt survives.
  assert.deepEqual(
    recordToTurn({ type: "user", message: { content: "Build the thing" } }),
    { role: "user", parts: [{ kind: "text", text: "Build the thing" }] },
  );
});

test("user tool_result blocks are dropped; array text survives", () => {
  const rec = {
    type: "user",
    message: {
      content: [
        { type: "tool_result", content: "huge tool output" },
        { type: "text", text: "and also do this" },
      ],
    },
  };
  assert.deepEqual(recordToTurn(rec), {
    role: "user",
    parts: [{ kind: "text", text: "and also do this" }],
  });
});

test("bookkeeping record types produce no turn", () => {
  for (const type of [
    "system",
    "mode",
    "permission-mode",
    "file-history-snapshot",
    "attachment",
    "ai-title",
    "last-prompt",
    "queue-operation",
  ]) {
    assert.equal(recordToTurn({ type, message: { content: "x" } }), null);
  }
});

test("empty assistant turn (no text, no tool) is dropped", () => {
  assert.equal(
    recordToTurn({ type: "assistant", message: { content: [] } }),
    null,
  );
  assert.equal(
    recordToTurn({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "…" }] },
    }),
    null,
  );
});

test("truncation notice: cap keeps the LAST N and reports the total", () => {
  const records = Array.from({ length: 12 }, (_, i) => ({
    type: "user",
    message: { content: `msg ${i}` },
  }));
  const view = simplifyRecords(records, "T", 5);
  assert.equal(view.total, 12);
  assert.equal(view.truncated, true);
  assert.equal(view.turns.length, 5);
  // Last 5 are msg 7..11.
  assert.equal(
    view.turns[0].parts[0].kind === "text" && view.turns[0].parts[0].text,
    "msg 7",
  );
  assert.equal(
    view.turns[4].parts[0].kind === "text" && view.turns[4].parts[0].text,
    "msg 11",
  );
});

test("torn / malformed values never throw", () => {
  assert.equal(recordToTurn(null), null);
  assert.equal(recordToTurn("not json"), null);
  assert.equal(recordToTurn(42), null);
  assert.equal(recordToTurn({ type: "assistant" }), null);
  assert.equal(recordToTurn({ type: "assistant", message: {} }), null);
});

// --- real transcripts (read-only; skipped if not present) -------------------

const PROJECT_DIR = path.join(
  os.homedir(),
  ".claude",
  "projects",
  "C--Users-osmao-Desktop-projects-intelligents",
);

test("real transcripts parse within the cap and stream (no whole-file slurp)", async (t) => {
  let files: string[];
  try {
    files = (await fs.readdir(PROJECT_DIR)).filter((f) =>
      f.toLowerCase().endsWith(".jsonl"),
    );
  } catch {
    t.skip("real project dir not present in this environment");
    return;
  }
  if (files.length === 0) {
    t.skip("no real transcripts present");
    return;
  }
  for (const file of files) {
    const filePath = path.join(PROJECT_DIR, file);
    const { size } = await fs.stat(filePath);
    const view = await loadTranscript(filePath, file);
    // eslint-disable-next-line no-console
    console.log(
      `  ${file}: ${(size / 1024).toFixed(0)}KB -> total ${view.total} turns, rendered ${view.turns.length}, truncated=${view.truncated}`,
    );
    assert.ok(view.turns.length <= DEFAULT_TURN_CAP, "never exceeds cap");
    assert.equal(view.truncated, view.total > DEFAULT_TURN_CAP);
    // A real session always has at least one renderable turn.
    assert.ok(view.total > 0, `${file} produced no turns`);
  }
});
