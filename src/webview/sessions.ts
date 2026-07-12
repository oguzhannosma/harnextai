/**
 * Workflow Sessions cards webview.
 */
import {
  WorkflowSessionCard,
  WorkflowSessionsView,
  isWorkflowSessionsHostMessage,
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
  | { readonly kind: "sessions"; readonly data: WorkflowSessionsView };

let viewState: ViewState = { kind: "loading" };

const saved = vscode.getState() as ViewState | null;
if (saved && typeof saved === "object" && "kind" in saved) {
  viewState = saved;
  render();
}

window.addEventListener("message", (event: MessageEvent) => {
  const message: unknown = event.data;
  if (!isWorkflowSessionsHostMessage(message)) {
    console.warn("harnextai sessions: dropped invalid message", message);
    return;
  }
  viewState = { kind: "sessions", data: message.data };
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

function relativeTime(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) {
    return "just now";
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 48) {
    return `${hr}h ago`;
  }
  return `${Math.floor(hr / 24)}d ago`;
}

function statusClass(status: string): string {
  return `card-status card-status--${status}`;
}

function renderCard(card: WorkflowSessionCard): HTMLElement {
  const open = el("button", {
    className: "card-btn card-btn--primary",
    type: "button",
    textContent: "Open",
  });
  const del = el("button", {
    className: "card-btn card-btn--danger",
    type: "button",
    textContent: "Delete",
  });
  open.addEventListener("click", () => {
    vscode.postMessage({ type: "openSession", slug: card.slug });
  });
  del.addEventListener("click", () => {
    vscode.postMessage({ type: "deleteSession", slug: card.slug });
  });

  return el("article", { className: "session-card" }, [
    el("div", { className: "card-top" }, [
      el("span", { className: "card-issue" }, [`#${card.issue}`]),
      el("span", { className: statusClass(card.status) }, [card.status]),
    ]),
    el("h3", { className: "card-title" }, [card.title]),
    el("div", { className: "card-meta" }, [
      el("span", { className: "card-chip" }, [card.step]),
      el("span", { className: "card-chip muted" }, [card.runtime]),
      el("span", { className: "card-chip muted" }, [
        relativeTime(card.createdAt),
      ]),
    ]),
    card.note.trim()
      ? el("p", { className: "card-note" }, [card.note.trim()])
      : document.createTextNode(""),
    el("div", { className: "card-actions" }, [open, del]),
  ]);
}

function render(): void {
  root.textContent = "";
  if (viewState.kind === "loading") {
    root.append(el("p", { className: "hint" }, ["Loading sessions…"]));
    return;
  }
  const { sessions } = viewState.data;
  if (sessions.length === 0) {
    root.append(
      el("div", { className: "empty" }, [
        el("p", { className: "empty-title" }, ["No workflow sessions"]),
        el("p", { className: "hint" }, [
          "Trigger a workflow from an issue to see a live session card here.",
        ]),
      ]),
    );
    return;
  }
  const list = el("div", { className: "card-list" });
  for (const card of sessions) {
    list.append(renderCard(card));
  }
  root.append(list);
}

vscode.postMessage({ type: "ready" });
