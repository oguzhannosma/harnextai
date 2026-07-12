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
  | { readonly type: "save"; readonly data: FormData }
  | { readonly type: "openFile"; readonly path: string };

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
    case "openFile":
      return typeof v.path === "string" && v.path.length > 0;
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

// -- Workflow graph (sidebar webview) ----------------------------------------

export type WorkflowProgressStatus =
  "active" | "waiting-user" | "done" | "blocked";

export interface WorkflowGraphStep {
  readonly step: string;
  readonly action: string;
}

export interface WorkflowGraphView {
  readonly trigger: string;
  readonly steps: readonly WorkflowGraphStep[];
  /** Highlight from session `progress.md`, when present. */
  readonly activeStepIndex?: number;
  readonly progressStatus?: WorkflowProgressStatus;
  readonly progressIssue?: number;
  readonly progressStep?: string;
  readonly progressUpdatedAt?: string;
  readonly progressNote?: string;
  /** One-shot: play success/confetti when status just became `done`. */
  readonly celebrateDone?: boolean;
}

export type WorkflowGraphHostMessage =
  | { readonly type: "workflow"; readonly data: WorkflowGraphView }
  | { readonly type: "workflowError"; readonly message: string };

/** Webview → host for Workflow graph actions. */
export type WorkflowGraphWebviewMessage =
  | ReadyMessage
  | { readonly type: "continueWorkflow"; readonly issue: number }
  | { readonly type: "openWorkflowTerminal"; readonly issue: number };

export function isWorkflowGraphWebviewMessage(
  v: unknown,
): v is WorkflowGraphWebviewMessage {
  if (!isRecord(v)) {
    return false;
  }
  if (v.type === "ready") {
    return true;
  }
  if (
    (v.type === "continueWorkflow" || v.type === "openWorkflowTerminal") &&
    typeof v.issue === "number"
  ) {
    return true;
  }
  return false;
}

/** One card in the Workflow Sessions webview. */
export interface WorkflowSessionCard {
  readonly slug: string;
  readonly issue: number;
  readonly title: string;
  readonly step: string;
  readonly status: WorkflowProgressStatus | "unknown";
  readonly runtime: string;
  readonly createdAt: number;
  readonly worktreePath: string;
  readonly note: string;
}

export interface WorkflowSessionsView {
  readonly sessions: readonly WorkflowSessionCard[];
}

export type WorkflowSessionsHostMessage = {
  readonly type: "sessions";
  readonly data: WorkflowSessionsView;
};

export type WorkflowSessionsWebviewMessage =
  | ReadyMessage
  | { readonly type: "openSession"; readonly slug: string }
  | { readonly type: "deleteSession"; readonly slug: string };

export function isWorkflowSessionsView(v: unknown): v is WorkflowSessionsView {
  return (
    isRecord(v) &&
    Array.isArray(v.sessions) &&
    v.sessions.every(isWorkflowSessionCard)
  );
}

function isWorkflowSessionCard(v: unknown): v is WorkflowSessionCard {
  return (
    isRecord(v) &&
    typeof v.slug === "string" &&
    typeof v.issue === "number" &&
    typeof v.title === "string" &&
    typeof v.step === "string" &&
    typeof v.status === "string" &&
    typeof v.runtime === "string" &&
    typeof v.createdAt === "number" &&
    typeof v.worktreePath === "string" &&
    typeof v.note === "string"
  );
}

export function isWorkflowSessionsHostMessage(
  v: unknown,
): v is WorkflowSessionsHostMessage {
  return isRecord(v) && v.type === "sessions" && isWorkflowSessionsView(v.data);
}

export function isWorkflowSessionsWebviewMessage(
  v: unknown,
): v is WorkflowSessionsWebviewMessage {
  if (!isRecord(v)) {
    return false;
  }
  if (v.type === "ready") {
    return true;
  }
  if (
    (v.type === "openSession" || v.type === "deleteSession") &&
    typeof v.slug === "string"
  ) {
    return true;
  }
  return false;
}

function isWorkflowGraphStep(v: unknown): v is WorkflowGraphStep {
  return (
    isRecord(v) && typeof v.step === "string" && typeof v.action === "string"
  );
}

function isWorkflowProgressStatus(v: unknown): v is WorkflowProgressStatus {
  return (
    v === "active" || v === "waiting-user" || v === "done" || v === "blocked"
  );
}

export function isWorkflowGraphView(v: unknown): v is WorkflowGraphView {
  if (
    !isRecord(v) ||
    typeof v.trigger !== "string" ||
    !Array.isArray(v.steps) ||
    !v.steps.every(isWorkflowGraphStep)
  ) {
    return false;
  }
  if (
    v.activeStepIndex !== undefined &&
    (typeof v.activeStepIndex !== "number" || v.activeStepIndex < 0)
  ) {
    return false;
  }
  if (
    v.progressStatus !== undefined &&
    !isWorkflowProgressStatus(v.progressStatus)
  ) {
    return false;
  }
  if (v.progressIssue !== undefined && typeof v.progressIssue !== "number") {
    return false;
  }
  if (v.progressStep !== undefined && typeof v.progressStep !== "string") {
    return false;
  }
  if (
    v.progressUpdatedAt !== undefined &&
    typeof v.progressUpdatedAt !== "string"
  ) {
    return false;
  }
  if (v.progressNote !== undefined && typeof v.progressNote !== "string") {
    return false;
  }
  if (v.celebrateDone !== undefined && typeof v.celebrateDone !== "boolean") {
    return false;
  }
  return true;
}

export function isWorkflowGraphHostMessage(
  v: unknown,
): v is WorkflowGraphHostMessage {
  if (!isRecord(v)) {
    return false;
  }
  if (v.type === "workflow") {
    return isWorkflowGraphView(v.data);
  }
  if (v.type === "workflowError") {
    return typeof v.message === "string";
  }
  return false;
}

// -- Harness Doctor (sidebar webview) ----------------------------------------

export type HarnessDoctorSeverity = "error" | "warn" | "info";

export interface HarnessDoctorFinding {
  readonly severity: HarnessDoctorSeverity;
  readonly category: string;
  readonly message: string;
  readonly fixable: boolean;
}

export interface HarnessDoctorView {
  readonly hasHarness: boolean;
  readonly findings: readonly HarnessDoctorFinding[];
  readonly fixActions?: readonly string[];
  readonly error?: string;
}

export type HarnessDoctorHostMessage = {
  readonly type: "doctor";
  readonly data: HarnessDoctorView;
};

export type HarnessDoctorWebviewMessage =
  | ReadyMessage
  | { readonly type: "refreshDoctor" }
  | { readonly type: "fixAllDoctor" }
  | { readonly type: "bootstrapHarness" };

function isHarnessDoctorSeverity(v: unknown): v is HarnessDoctorSeverity {
  return v === "error" || v === "warn" || v === "info";
}

function isHarnessDoctorFinding(v: unknown): v is HarnessDoctorFinding {
  return (
    isRecord(v) &&
    isHarnessDoctorSeverity(v.severity) &&
    typeof v.category === "string" &&
    typeof v.message === "string" &&
    typeof v.fixable === "boolean"
  );
}

export function isHarnessDoctorView(v: unknown): v is HarnessDoctorView {
  if (!isRecord(v) || typeof v.hasHarness !== "boolean") {
    return false;
  }
  if (!Array.isArray(v.findings) || !v.findings.every(isHarnessDoctorFinding)) {
    return false;
  }
  if (v.fixActions !== undefined && !isStringArray(v.fixActions)) {
    return false;
  }
  if (v.error !== undefined && typeof v.error !== "string") {
    return false;
  }
  return true;
}

export function isHarnessDoctorHostMessage(
  v: unknown,
): v is HarnessDoctorHostMessage {
  return isRecord(v) && v.type === "doctor" && isHarnessDoctorView(v.data);
}

export function isHarnessDoctorWebviewMessage(
  v: unknown,
): v is HarnessDoctorWebviewMessage {
  if (!isRecord(v)) {
    return false;
  }
  if (
    v.type === "ready" ||
    v.type === "refreshDoctor" ||
    v.type === "fixAllDoctor" ||
    v.type === "bootstrapHarness"
  ) {
    return true;
  }
  return false;
}
