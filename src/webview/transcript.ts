/**
 * Read-only transcript webview. Bundled by esbuild to `media/transcript.js`
 * (browser IIFE) and loaded by `src/transcriptPanel.ts`. Dependency-free plain
 * DOM. Imports the SHARED protocol/validator from `../shared/messages` so both
 * sides agree on the wire format. All values are written via DOM properties
 * (`.textContent`), never `innerHTML`, so transcript content can't inject markup.
 */
import {
  TranscriptView,
  TranscriptTurn,
  isTranscriptHostMessage,
} from "../shared/messages";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root") as HTMLElement;

let current: TranscriptView | null = null;

// Restore retained state (across a webview reload) before the host replies.
const saved = vscode.getState();
if (saved && typeof saved === "object") {
  current = saved as TranscriptView;
  render();
}

window.addEventListener("message", (event: MessageEvent) => {
  const message: unknown = event.data;
  if (!isTranscriptHostMessage(message)) {
    console.warn("intelligents transcript: dropped invalid message", message);
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
  if (!current) {
    root.append(el("p", { className: "hint" }, ["Loading transcript…"]));
    return;
  }

  root.append(
    el("header", { className: "panel-head" }, [
      el("h1", { className: "panel-title" }, [current.title || "Transcript"]),
      el("span", { className: "panel-sub" }, [
        `${current.total} turn${current.total === 1 ? "" : "s"}`,
      ]),
    ]),
  );

  if (current.truncated) {
    root.append(
      el("p", { className: "notice" }, [
        `Showing the last ${current.turns.length} of ${current.total} turns.`,
      ]),
    );
  }

  if (current.turns.length === 0) {
    root.append(
      el("p", { className: "hint" }, [
        "No renderable messages in this session.",
      ]),
    );
    return;
  }

  const list = el("div", { className: "turns" });
  for (const turn of current.turns) {
    list.append(renderTurn(turn));
  }
  root.append(list);
}

function renderTurn(turn: TranscriptTurn): HTMLElement {
  const roleLabel = turn.role === "user" ? "User" : "Assistant";
  const parts: (Node | string)[] = [
    el("div", { className: "turn-role" }, [roleLabel]),
  ];
  for (const part of turn.parts) {
    if (part.kind === "tool") {
      parts.push(el("div", { className: "tool-line" }, [`⚙ ${part.name}`]));
    } else {
      parts.push(el("div", { className: "turn-text" }, [part.text]));
    }
  }
  return el("article", { className: `turn turn-${turn.role}` }, parts);
}

// Announce readiness so the host streams the authoritative transcript.
vscode.postMessage({ type: "ready" });
