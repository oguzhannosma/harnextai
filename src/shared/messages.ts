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

// ===========================================================================
// Read-only visibility panels (Transcript viewer + Live memory panel).
//
// These two webviews are strictly one-directional for data: the extension host
// pushes a fully-simplified view, the webview only renders it and (on load)
// sends a single `ready`. They share the `ReadyMessage` below for the upward
// direction; the downward direction has one host-message type each. The types
// live here (not in the panel modules) so the webview bundles and the host both
// validate against the same source of truth, exactly like `FormData`.
// ===========================================================================

/** The only message the read-only webviews send upward. */
export type ReadyMessage = { readonly type: "ready" };

export function isReadyMessage(v: unknown): v is ReadyMessage {
  return isRecord(v) && v.type === "ready";
}

// -- Transcript viewer -------------------------------------------------------

/** One rendered piece of an assistant turn: either prose or a compact tool
 * marker (`⚙ ToolName`). Tool inputs/outputs are deliberately NOT carried. */
export type TranscriptPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string };

/** A single simplified turn. User turns carry only `text` parts. */
export interface TranscriptTurn {
  readonly role: "user" | "assistant";
  readonly parts: readonly TranscriptPart[];
}

/** The full payload for the transcript webview — simplified turns only, never
 * raw jsonl. `total` is the renderable-turn count before capping; `truncated`
 * is true when `turns` is only the last-N slice of a longer transcript. */
export interface TranscriptView {
  readonly title: string;
  readonly turns: readonly TranscriptTurn[];
  readonly total: number;
  readonly truncated: boolean;
}

export type TranscriptHostMessage = {
  readonly type: "transcript";
  readonly data: TranscriptView;
};

function isTranscriptPart(v: unknown): v is TranscriptPart {
  if (!isRecord(v)) {
    return false;
  }
  switch (v.kind) {
    case "text":
      return typeof v.text === "string";
    case "tool":
      return typeof v.name === "string";
    default:
      return false;
  }
}

function isTranscriptTurn(v: unknown): v is TranscriptTurn {
  return (
    isRecord(v) &&
    (v.role === "user" || v.role === "assistant") &&
    Array.isArray(v.parts) &&
    v.parts.every(isTranscriptPart)
  );
}

export function isTranscriptView(v: unknown): v is TranscriptView {
  return (
    isRecord(v) &&
    typeof v.title === "string" &&
    typeof v.total === "number" &&
    typeof v.truncated === "boolean" &&
    Array.isArray(v.turns) &&
    v.turns.every(isTranscriptTurn)
  );
}

export function isTranscriptHostMessage(
  v: unknown,
): v is TranscriptHostMessage {
  return isRecord(v) && v.type === "transcript" && isTranscriptView(v.data);
}

// -- Live memory panel -------------------------------------------------------

/** One memory file rendered as a section: budget bar + entry list. */
export interface MemoryPanelSection {
  readonly label: string;
  readonly filePath: string;
  readonly budget: number;
  readonly used: number;
  readonly overBudget: boolean;
  readonly entries: readonly string[];
}

export interface MemoryPanelView {
  readonly sections: readonly MemoryPanelSection[];
}

export type MemoryPanelHostMessage = {
  readonly type: "memory";
  readonly data: MemoryPanelView;
};

function isMemoryPanelSection(v: unknown): v is MemoryPanelSection {
  return (
    isRecord(v) &&
    typeof v.label === "string" &&
    typeof v.filePath === "string" &&
    typeof v.budget === "number" &&
    typeof v.used === "number" &&
    typeof v.overBudget === "boolean" &&
    isStringArray(v.entries)
  );
}

export function isMemoryPanelView(v: unknown): v is MemoryPanelView {
  return (
    isRecord(v) &&
    Array.isArray(v.sections) &&
    v.sections.every(isMemoryPanelSection)
  );
}

export function isMemoryPanelHostMessage(
  v: unknown,
): v is MemoryPanelHostMessage {
  return isRecord(v) && v.type === "memory" && isMemoryPanelView(v.data);
}
