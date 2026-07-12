/**
 * Harness Doctor sidebar webview.
 */
import {
  HarnessDoctorFinding,
  HarnessDoctorView,
  isHarnessDoctorHostMessage,
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
  | { readonly kind: "doctor"; readonly data: HarnessDoctorView };

let viewState: ViewState = { kind: "loading" };

const saved = vscode.getState() as ViewState | null;
if (saved && typeof saved === "object" && "kind" in saved) {
  viewState = saved;
  render();
}

window.addEventListener("message", (event: MessageEvent) => {
  const message: unknown = event.data;
  if (!isHarnessDoctorHostMessage(message)) {
    console.warn("harnextai doctor: dropped invalid message", message);
    return;
  }
  viewState = { kind: "doctor", data: message.data };
  vscode.setState(viewState);
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

function severityLabel(severity: string): string {
  switch (severity) {
    case "error":
      return "Error";
    case "warn":
      return "Warning";
    case "info":
      return "Info";
    default:
      return severity;
  }
}

function countBySeverity(
  findings: readonly HarnessDoctorFinding[],
): Record<string, number> {
  const counts: Record<string, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

function renderFinding(f: HarnessDoctorFinding): HTMLElement {
  return el("li", { className: `finding finding--${f.severity}` }, [
    el("div", { className: "finding-top" }, [
      el("span", { className: "finding-severity" }, [
        severityLabel(f.severity),
      ]),
      el("span", { className: "finding-category" }, [f.category]),
      f.fixable
        ? el("span", { className: "finding-badge" }, ["fixable"])
        : document.createDocumentFragment(),
    ]),
    el("p", { className: "finding-message" }, [f.message]),
  ]);
}

function renderGroup(
  severity: "error" | "warn" | "info",
  findings: readonly HarnessDoctorFinding[],
): HTMLElement | null {
  const group = findings.filter((f) => f.severity === severity);
  if (group.length === 0) {
    return null;
  }
  return el("section", { className: `group group--${severity}` }, [
    el("h3", { className: "group-title" }, [
      `${severityLabel(severity)}s (${group.length})`,
    ]),
    el("ul", { className: "finding-list" }, group.map(renderFinding)),
  ]);
}

function renderActions(
  hasHarness: boolean,
  findings: readonly HarnessDoctorFinding[],
): HTMLElement {
  const fixable = findings.some((f) => f.fixable);
  const children: (Node | string)[] = [
    el(
      "button",
      {
        className: "btn",
        type: "button",
        onclick: () => vscode.postMessage({ type: "refreshDoctor" }),
      },
      ["Refresh"],
    ),
  ];
  if (hasHarness && fixable) {
    children.unshift(
      el(
        "button",
        {
          className: "btn btn--primary",
          type: "button",
          onclick: () => vscode.postMessage({ type: "fixAllDoctor" }),
        },
        ["Fix all"],
      ),
    );
  }
  if (!hasHarness) {
    children.unshift(
      el(
        "button",
        {
          className: "btn btn--primary",
          type: "button",
          onclick: () => vscode.postMessage({ type: "bootstrapHarness" }),
        },
        ["Initialize Harness"],
      ),
    );
  }
  return el("div", { className: "actions" }, children);
}

function render(): void {
  root.replaceChildren();
  if (viewState.kind === "loading") {
    root.append(el("p", { className: "hint" }, ["Loading doctor checks…"]));
    return;
  }

  const data = viewState.data;
  if (data.error) {
    root.append(
      el("div", { className: "empty" }, [
        el("p", { className: "empty-title" }, ["Doctor error"]),
        el("p", { className: "hint" }, [data.error]),
        renderActions(data.hasHarness, data.findings),
      ]),
    );
    return;
  }

  if (!data.hasHarness) {
    root.append(
      el("div", { className: "empty" }, [
        el("p", { className: "empty-title" }, ["No harness yet"]),
        el("p", { className: "hint" }, [
          "Initialize a `.harness/` skeleton to manage agents, skills, and stubs from Harnext AI.",
        ]),
        renderActions(false, []),
      ]),
    );
    return;
  }

  const counts = countBySeverity(data.findings);
  const total = data.findings.length;
  const header = el("header", { className: "doctor-header" }, [
    el("h2", { className: "doctor-title" }, [
      total === 0 ? "All clear" : `${total} finding${total === 1 ? "" : "s"}`,
    ]),
    total > 0
      ? el("p", { className: "doctor-summary" }, [
          [
            counts.error
              ? `${counts.error} error${counts.error === 1 ? "" : "s"}`
              : "",
            counts.warn
              ? `${counts.warn} warning${counts.warn === 1 ? "" : "s"}`
              : "",
            counts.info ? `${counts.info} info` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        ])
      : el("p", { className: "hint" }, [
          "Stubs, skill copies, and memory headers look good.",
        ]),
    renderActions(true, data.findings),
  ]);
  root.append(header);

  if (data.fixActions && data.fixActions.length > 0) {
    root.append(
      el("section", { className: "fix-log" }, [
        el("h3", { className: "group-title" }, ["Last fixes"]),
        el(
          "ul",
          { className: "fix-list" },
          data.fixActions.map((a) => el("li", {}, [a])),
        ),
      ]),
    );
  }

  if (total === 0) {
    return;
  }

  const groups = el("div", { className: "groups" }, []);
  for (const severity of ["error", "warn", "info"] as const) {
    const group = renderGroup(severity, data.findings);
    if (group) {
      groups.append(group);
    }
  }
  root.append(groups);
}

vscode.postMessage({ type: "ready" });
