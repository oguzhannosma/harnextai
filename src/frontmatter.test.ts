import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseDocument, serializeDocument, setKey } from "./frontmatter";

// --- single-line scalars ----------------------------------------------------

test("parses flat single-line key: value scalars", () => {
  const doc = parseDocument(
    `---\nname: My Agent\ndescription: A short one-line description\n---\n\nBody text.\n`,
  );
  assert.equal(doc.hasFrontmatter, true);
  assert.deepEqual(doc.keyOrder, ["name", "description"]);
  assert.equal(doc.frontmatter.name, "My Agent");
  assert.equal(doc.frontmatter.description, "A short one-line description");
  assert.equal(doc.body, "Body text.\n");
});

test("serializes single-line values as key: value", () => {
  const doc = parseDocument(`---\nname: Agent\n---\n\nHi.\n`);
  assert.equal(serializeDocument(doc), `---\nname: Agent\n---\n\nHi.\n`);
});

// --- folded block scalars (>-) ----------------------------------------------

test("folds `>-` soft-wrapped lines into a single spaced line", () => {
  const doc = parseDocument(
    `---\nname: A\ndescription: >-\n  Architecture rules for this thing.\n  Use when editing source.\nother: kept\n---\n\nBody.\n`,
  );
  assert.equal(
    doc.frontmatter.description,
    "Architecture rules for this thing. Use when editing source.",
  );
  // Keys after the block are still parsed.
  assert.equal(doc.frontmatter.other, "kept");
  assert.deepEqual(doc.keyOrder, ["name", "description", "other"]);
  // The literal indicator is never stored.
  assert.notEqual(doc.frontmatter.description, ">-");
});

test("`>-` with blank-line separated paragraphs becomes real newlines", () => {
  const doc = parseDocument(
    `---\ndescription: >-\n  first line\n\n  second line\n---\n\nBody.\n`,
  );
  assert.equal(doc.frontmatter.description, "first line\nsecond line");
});

// --- literal block scalars (|) ----------------------------------------------

test("parses `|` literal blocks preserving line breaks (clip default)", () => {
  const doc = parseDocument(
    `---\ndescription: |\n  line one\n  line two\n---\n\nBody.\n`,
  );
  // Clip chomping keeps a single trailing newline.
  assert.equal(doc.frontmatter.description, "line one\nline two\n");
});

test("parses `|-` literal blocks with strip chomping", () => {
  const doc = parseDocument(
    `---\ndescription: |-\n  line one\n  line two\n---\n\nBody.\n`,
  );
  assert.equal(doc.frontmatter.description, "line one\nline two");
});

test("parses `>+` keep chomping preserving trailing newlines", () => {
  const doc = parseDocument(`---\ndescription: >+\n  text\n\n\n---\n\nBody.\n`);
  assert.equal(doc.frontmatter.description, "text\n\n\n");
});

// --- empty values -----------------------------------------------------------

test("handles an empty block scalar as an empty string", () => {
  const doc = parseDocument(
    `---\nname: A\ndescription: >-\nother: kept\n---\n\nBody.\n`,
  );
  assert.equal(doc.frontmatter.description, "");
  assert.equal(doc.frontmatter.other, "kept");
});

test("handles empty document with no frontmatter", () => {
  const doc = parseDocument(`just a body, no fence\n`);
  assert.equal(doc.hasFrontmatter, false);
  assert.deepEqual(doc.frontmatter, {});
  assert.equal(doc.body, "just a body, no fence\n");
});

// --- serialization of multiline values --------------------------------------

test("serializes multiline value (real newlines) as a block scalar", () => {
  const doc = parseDocument(`---\nname: A\n---\n\nBody.\n`);
  setKey(doc, "description", "line one\nline two");
  const out = serializeDocument(doc);
  assert.match(out, /description: >-\n {2}line one\n\n {2}line two/);
});

test("serializes value with blank lines as literal `|-` block", () => {
  const doc = parseDocument(`---\nname: A\n---\n\nBody.\n`);
  // setKey trims, so bake the blank line inside the value.
  doc.frontmatter.description = "a\n\nb";
  doc.keyOrder.push("description");
  const out = serializeDocument(doc);
  assert.match(out, /description: \|-\n {2}a\n\n {2}b/);
});

// --- round-trip -------------------------------------------------------------

test("round-trips a `>-` folded description through parse->serialize->parse", () => {
  const original = `---\nname: My Agent\ndescription: >-\n  first paragraph\n\n  second paragraph\nmodel: opus\n---\n\n# Heading\n\nSome body.\n`;
  const doc = parseDocument(original);
  const value = doc.frontmatter.description;
  assert.equal(value, "first paragraph\nsecond paragraph");

  const serialized = serializeDocument(doc);
  const reparsed = parseDocument(serialized);
  assert.equal(reparsed.frontmatter.description, value);
  assert.equal(reparsed.frontmatter.name, "My Agent");
  assert.equal(reparsed.frontmatter.model, "opus");
  assert.deepEqual(reparsed.keyOrder, ["name", "description", "model"]);
  assert.equal(reparsed.body, doc.body);

  // Idempotent from the second serialization onward.
  assert.equal(serializeDocument(reparsed), serialized);
});

test("round-trips a `|-` literal block value", () => {
  const original = `---\ndescription: |-\n  step one\n  step two\n  step three\n---\n\nBody.\n`;
  const doc = parseDocument(original);
  assert.equal(doc.frontmatter.description, "step one\nstep two\nstep three");

  const reparsed = parseDocument(serializeDocument(doc));
  assert.equal(reparsed.frontmatter.description, doc.frontmatter.description);
});

test("round-trips single-line frontmatter unchanged", () => {
  const original = `---\nname: Agent\nmodel: opus\n---\n\nBody line.\n`;
  const doc = parseDocument(original);
  assert.equal(serializeDocument(doc), original);
});
