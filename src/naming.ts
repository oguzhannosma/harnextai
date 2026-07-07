/**
 * Slug-name validation shared by the "New Agent" / "New Skill" / "Duplicate"
 * flows. Agent files (`<name>.md`) and skill dirs (`<name>/SKILL.md`) both key
 * off a slug-safe name, so the rules live in one pure, `vscode`-free place.
 */

/** Lowercase alphanumerics in single-hyphen-separated groups (e.g. `code-reviewer`). */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate a proposed slug name against the format rules and the set of names
 * already in use (case-insensitive). Returns a human-readable error string when
 * invalid, or `undefined` when the name is acceptable — the shape VS Code's
 * `InputBox.validateInput` expects.
 */
export function validateSlugName(
  name: string,
  existing: readonly string[],
): string | undefined {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "Name is required.";
  }
  if (!SLUG_RE.test(trimmed)) {
    return "Use lowercase letters, digits and single hyphens, e.g. code-reviewer.";
  }
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (taken.has(trimmed.toLowerCase())) {
    return `"${trimmed}" already exists — pick another name.`;
  }
  return undefined;
}
