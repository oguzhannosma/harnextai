/**
 * Single source of truth for the webview <-> extension message protocol and the
 * form-data shapes they exchange.
 *
 * This module is imported by BOTH the extension host (`src/formPanel.ts`) and
 * the webview bundle (`src/webview/main.ts`), so it must stay dependency-free:
 * no `vscode`, no `node:*`. Only plain types and runtime validators live here.
 *
 * The validators (`isWebviewMessage` / `isHostMessage`) are the *same code* run
 * on both sides — every payload crossing `postMessage` is validated against the
 * discriminated unions below; anything that fails validation is logged and
 * dropped rather than acted on.
 */

export type FormKind = "agent" | "skill" | "memory";

/** Editable view of a `.harness/agents/*.md` file. Unknown frontmatter keys are
 * NOT carried here — they are preserved on disk by re-reading the file on save. */
export interface AgentFormData {
  readonly kind: "agent";
  readonly filePath: string;
  readonly name: string;
  readonly description: string;
  readonly model: string;
  readonly tools: string;
  readonly body: string;
}

/** Editable view of a `.harness/skills/<name>/SKILL.md` file. */
export interface SkillFormData {
  readonly kind: "skill";
  readonly filePath: string;
  readonly name: string;
  readonly description: string;
  readonly disableModelInvocation: boolean;
  readonly body: string;
}

/** Editable view of a memory file (personal or team). No frontmatter — a budget
 * header plus `---`-separated entries. */
export interface MemoryFormData {
  readonly kind: "memory";
  readonly filePath: string;
  readonly label: string;
  readonly budget: number;
  readonly entries: readonly string[];
}

export type FormData = AgentFormData | SkillFormData | MemoryFormData;

/** Extension host -> webview. */
export type HostMessage =
  | { readonly type: "state"; readonly data: FormData }
  | { readonly type: "saved" }
  | { readonly type: "error"; readonly message: string };

/** Webview -> extension host. */
export type WebviewMessage =
  | { readonly type: "ready" }
  | { readonly type: "save"; readonly data: FormData };

// ---------------------------------------------------------------------------
// Runtime validation — shared by both sides. Deliberately strict and total: a
// malformed payload must never throw, only return false.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((e) => typeof e === "string");
}

export function isFormData(v: unknown): v is FormData {
  if (!isRecord(v)) {
    return false;
  }
  switch (v.kind) {
    case "agent":
      return (
        typeof v.filePath === "string" &&
        typeof v.name === "string" &&
        typeof v.description === "string" &&
        typeof v.model === "string" &&
        typeof v.tools === "string" &&
        typeof v.body === "string"
      );
    case "skill":
      return (
        typeof v.filePath === "string" &&
        typeof v.name === "string" &&
        typeof v.description === "string" &&
        typeof v.disableModelInvocation === "boolean" &&
        typeof v.body === "string"
      );
    case "memory":
      return (
        typeof v.filePath === "string" &&
        typeof v.label === "string" &&
        typeof v.budget === "number" &&
        isStringArray(v.entries)
      );
    default:
      return false;
  }
}

export function isWebviewMessage(v: unknown): v is WebviewMessage {
  if (!isRecord(v)) {
    return false;
  }
  switch (v.type) {
    case "ready":
      return true;
    case "save":
      return isFormData(v.data);
    default:
      return false;
  }
}

export function isHostMessage(v: unknown): v is HostMessage {
  if (!isRecord(v)) {
    return false;
  }
  switch (v.type) {
    case "state":
      return isFormData(v.data);
    case "saved":
      return true;
    case "error":
      return typeof v.message === "string";
    default:
      return false;
  }
}
