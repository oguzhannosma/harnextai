/**
 * Workflow graph sidebar webview — rich flow with lit connectors, waiting card,
 * elapsed time, and done confetti.
 */
import {
  WorkflowGraphView,
  WorkflowProgressStatus,
  isWorkflowGraphHostMessage,
} from "../shared/messages";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root") as HTMLElement;

type ViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "workflow"; readonly data: WorkflowGraphView }
  | { readonly kind: "error"; readonly message: string };

interface PersistedUi {
  readonly view: ViewState;
  readonly expandedIndex: number | null;
}

let viewState: ViewState = { kind: "loading" };
let expandedIndex: number | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;
let confettiClear: ReturnType<typeof setTimeout> | undefined;

const saved = vscode.getState() as PersistedUi | ViewState | null;
if (saved && typeof saved === "object") {
  if ("view" in saved && saved.view) {
    viewState = saved.view;
    expandedIndex =
      typeof saved.expandedIndex === "number" ? saved.expandedIndex : null;
  } else if ("kind" in saved) {
    viewState = saved as ViewState;
  }
  render();
}

function persist(): void {
  vscode.setState({ view: viewState, expandedIndex } satisfies PersistedUi);
}

window.addEventListener("message", (event: MessageEvent) => {
  const message: unknown = event.data;
  if (!isWorkflowGraphHostMessage(message)) {
    console.warn("harnextai workflow: dropped invalid message", message);
    return;
  }
  if (message.type === "workflow") {
    viewState = { kind: "workflow", data: message.data };
  } else {
    viewState = { kind: "error", message: message.message };
  }
  persist();
  render();
});

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    node.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return node;
}

function isGate(stepId: string): boolean {
  return stepId === "user-gate" || stepId === "user";
}

const SVG_NS = "http://www.w3.org/2000/svg";

function robotIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "step-icon-svg");
  svg.setAttribute("aria-hidden", "true");
  const parts: Array<[string, Record<string, string>]> = [
    ["rect", { x: "5", y: "8", width: "14", height: "10", rx: "2" }],
    ["circle", { cx: "9", cy: "13", r: "1.2" }],
    ["circle", { cx: "15", cy: "13", r: "1.2" }],
    ["line", { x1: "12", y1: "4", x2: "12", y2: "8" }],
    ["circle", { cx: "12", cy: "3", r: "1.5" }],
    ["line", { x1: "5", y1: "18", x2: "3", y2: "21" }],
    ["line", { x1: "19", y1: "18", x2: "21", y2: "21" }],
  ];
  for (const [tag, attrs] of parts) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, v);
    }
    svg.append(node);
  }
  return svg;
}

function humanIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "step-icon-svg");
  svg.setAttribute("aria-hidden", "true");
  const parts: Array<[string, Record<string, string>]> = [
    ["circle", { cx: "12", cy: "8", r: "3.5" }],
    ["path", { d: "M5 20c0-4 3.5-6 7-6s7 2 7 6" }],
  ];
  for (const [tag, attrs] of parts) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, v);
    }
    svg.append(node);
  }
  return svg;
}

function statusClass(status: WorkflowProgressStatus | undefined): string {
  switch (status) {
    case "waiting-user":
      return "step-node--waiting";
    case "done":
      return "step-node--done";
    case "blocked":
      return "step-node--blocked";
    default:
      return "";
  }
}

function formatElapsed(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return "";
  }
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m`;
  }
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function statusLabel(status: WorkflowProgressStatus | undefined): string {
  switch (status) {
    case "waiting-user":
      return "waiting on you";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "active":
      return "active";
    default:
      return "idle";
  }
}

function spawnConfetti(): void {
  const layer = el("div", { className: "confetti-layer", ariaHidden: "true" });
  const colors = [
    "var(--vscode-textLink-foreground)",
    "var(--vscode-charts-blue, #3794ff)",
    "var(--vscode-charts-purple, #b180d7)",
    "var(--vscode-testing-iconPassed, #73c991)",
    "var(--vscode-charts-orange, #d18616)",
  ];
  for (let i = 0; i < 36; i++) {
    const piece = el("span", { className: "confetti-piece" });
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    piece.style.background = colors[i % colors.length]!;
    piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 80}px`);
    layer.append(piece);
  }
  root.append(layer);
  if (confettiClear) {
    clearTimeout(confettiClear);
  }
  confettiClear = setTimeout(() => layer.remove(), 2800);
}

function ensureElapsedTick(): void {
  if (elapsedTimer) {
    return;
  }
  elapsedTimer = setInterval(() => {
    if (viewState.kind !== "workflow") {
      return;
    }
    const label = root.querySelector(".sticky-elapsed");
    if (label && viewState.data.progressUpdatedAt) {
      label.textContent = formatElapsed(viewState.data.progressUpdatedAt);
    }
  }, 15000);
}

function render(): void {
  root.textContent = "";

  if (viewState.kind === "loading") {
    root.append(el("p", { className: "hint" }, ["Loading workflow…"]));
    return;
  }
  if (viewState.kind === "error") {
    root.append(el("p", { className: "hint error" }, [viewState.message]));
    return;
  }

  const data = viewState.data;
  const {
    trigger,
    steps,
    activeStepIndex,
    progressStatus,
    progressIssue,
    progressStep,
    progressUpdatedAt,
    progressNote,
    celebrateDone,
  } = data;

  if (typeof activeStepIndex === "number") {
    ensureElapsedTick();
  }

  // Sticky mission header
  const stickyBits: Node[] = [
    el("div", { className: "sticky-title-row" }, [
      el("span", { className: "sticky-kicker" }, ["Workflow"]),
      progressIssue !== undefined
        ? el("span", { className: "sticky-issue" }, [`#${progressIssue}`])
        : el("span", { className: "sticky-issue muted" }, ["no session"]),
    ]),
  ];
  if (progressStatus) {
    stickyBits.push(
      el("div", { className: "sticky-meta" }, [
        el(
          "span",
          {
            className: `status-pill status-pill--${progressStatus}`,
          },
          [statusLabel(progressStatus)],
        ),
        progressStep
          ? el("span", { className: "sticky-step" }, [progressStep])
          : document.createTextNode(""),
        progressUpdatedAt
          ? el("span", { className: "sticky-elapsed" }, [
              formatElapsed(progressUpdatedAt),
            ])
          : document.createTextNode(""),
      ]),
    );
  }
  root.append(el("header", { className: "sticky-head" }, stickyBits));

  // Waiting-on-you takeover
  if (progressStatus === "waiting-user" && progressIssue !== undefined) {
    const actions = el("div", { className: "waiting-actions" }, [
      el("button", {
        className: "waiting-btn waiting-btn--primary",
        type: "button",
        textContent: "Continue",
      }),
      el("button", {
        className: "waiting-btn",
        type: "button",
        textContent: "Open terminal",
      }),
    ]);
    const continueBtn = actions.children[0] as HTMLButtonElement;
    const openBtn = actions.children[1] as HTMLButtonElement;
    continueBtn.addEventListener("click", () => {
      vscode.postMessage({
        type: "continueWorkflow",
        issue: progressIssue,
      });
    });
    openBtn.addEventListener("click", () => {
      vscode.postMessage({
        type: "openWorkflowTerminal",
        issue: progressIssue,
      });
    });
    root.append(
      el("section", { className: "waiting-card" }, [
        el("h3", { className: "waiting-title" }, ["Waiting on you"]),
        el("p", { className: "waiting-body" }, [
          progressNote?.trim() ||
            `Step “${progressStep ?? "gate"}” needs approval before the workflow continues.`,
        ]),
        actions,
      ]),
    );
  }

  if (progressStatus === "done" && celebrateDone) {
    root.append(
      el("section", { className: "done-banner" }, [
        el("strong", {}, ["Workflow complete"]),
        el("span", {}, [" Nice work — review the session when ready."]),
      ]),
    );
  }

  root.append(el("p", { className: "flow-trigger" }, [trigger]));

  const flow = el("div", { className: "flow" });
  const allDone = progressStatus === "done";
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const gate = isGate(s.step);
    const isActive = !allDone && activeStepIndex === i;
    const isComplete =
      allDone || (typeof activeStepIndex === "number" && i < activeStepIndex);
    const isExpanded = expandedIndex === i;
    const classes = [
      "step-node",
      gate ? "step-node--gate" : "step-node--agent",
      isActive ? "step-node--active" : "",
      isComplete ? "step-node--complete" : "",
      isExpanded ? "step-node--expanded" : "",
      isActive ? statusClass(progressStatus) : "",
    ]
      .filter(Boolean)
      .join(" ");

    const head = el("button", {
      className: "step-head",
      type: "button",
    });
    head.append(gate ? humanIcon() : robotIcon());
    head.append(el("span", { className: "step-label" }, [s.step]));
    if (isActive && progressUpdatedAt) {
      head.append(
        el("span", { className: "step-elapsed" }, [
          formatElapsed(progressUpdatedAt),
        ]),
      );
    }
    head.addEventListener("click", () => {
      expandedIndex = expandedIndex === i ? null : i;
      persist();
      render();
    });

    const node = el("article", { className: classes }, [head]);
    if (isExpanded) {
      node.append(el("p", { className: "step-detail" }, [s.action]));
    }
    flow.append(node);

    if (i < steps.length - 1) {
      const nextLit =
        allDone || (typeof activeStepIndex === "number" && i < activeStepIndex);
      const arrow = el(
        "div",
        {
          className: nextLit
            ? "flow-connector flow-connector--lit"
            : isActive
              ? "flow-connector flow-connector--active"
              : "flow-connector",
        },
        [el("span", { className: "flow-connector-line" }), "↓"],
      );
      arrow.setAttribute("aria-hidden", "true");
      flow.append(arrow);
    }
  }
  root.append(flow);

  if (celebrateDone) {
    spawnConfetti();
  }
}

vscode.postMessage({ type: "ready" });
