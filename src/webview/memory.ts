/**
 * Read-only live-memory webview. Bundled by esbuild to `media/memory.js`
 * (browser IIFE) and loaded by `src/memoryPanelView.ts`. Dependency-free plain
 * DOM. Imports the SHARED protocol/validator from `../shared/messages`. All
 * values are written via DOM properties (`.textContent` / style widths), never
 * `innerHTML`, so memory content can't inject markup.
 */
import {
  MemoryPanelView,
  MemoryPanelSection,
  isMemoryPanelHostMessage,
} from "../shared/messages";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root") as HTMLElement;

let current: MemoryPanelView | null = null;

const saved = vscode.getState();
if (saved && typeof saved === "object") {
  current = saved as MemoryPanelView;
  render();
}

window.addEventListener("message", (event: MessageEvent) => {
  const message: unknown = event.data;
  if (!isMemoryPanelHostMessage(message)) {
    console.warn("intelligents memory: dropped invalid message", message);
    return;
  }
  current = message.data;
  vscode.setState(current);
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

function render(): void {
  root.textContent = "";
  root.append(
    el("header", { className: "panel-head" }, [
      el("h1", { className: "panel-title" }, ["Live Memory"]),
      el("span", { className: "panel-sub" }, ["updates as agents write"]),
    ]),
  );

  if (!current) {
    root.append(el("p", { className: "hint" }, ["Loading memory…"]));
    return;
  }
  if (current.sections.length === 0) {
    root.append(el("p", { className: "hint" }, ["No memory files found."]));
    return;
  }

  for (const section of current.sections) {
    root.append(renderSection(section));
  }
}

function renderSection(section: MemoryPanelSection): HTMLElement {
  const pct =
    section.budget > 0
      ? Math.min(100, Math.round((section.used / section.budget) * 100))
      : 0;
  const fill = el("div", {
    className: section.overBudget ? "bar-fill over" : "bar-fill",
  });
  fill.style.width = `${pct}%`;

  const counter = el(
    "span",
    { className: section.overBudget ? "counter over" : "counter" },
    [`${section.used} / ${section.budget} chars`],
  );

  const entries = el("div", { className: "entries" });
  if (section.entries.length === 0) {
    entries.append(el("p", { className: "hint" }, ["(empty)"]));
  } else {
    for (const entry of section.entries) {
      entries.append(el("pre", { className: "entry" }, [entry]));
    }
  }

  return el("section", { className: "mem-section" }, [
    el("div", { className: "mem-head" }, [
      el("span", { className: "mem-label" }, [section.label]),
      counter,
    ]),
    el("div", { className: "bar" }, [fill]),
    entries,
  ]);
}

// Announce readiness so the host pushes the authoritative memory state.
vscode.postMessage({ type: "ready" });
