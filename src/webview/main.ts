/**
 * Webview UI for the structured agent/skill/memory editor.
 *
 * Bundled by esbuild to `media/webview.js` (browser IIFE) and loaded by
 * `src/formPanel.ts`. Dependency-free per ground rule 3 — plain DOM, no
 * framework. Imports the SHARED message protocol/validators from
 * `../shared/messages` so both sides agree on the wire format (single source of
 * truth). All values are written via DOM properties (`.value`/`.textContent`),
 * never `innerHTML`, so untrusted file content can't inject markup.
 */
import {
  FormData,
  HostMessage,
  AgentFormData,
  SkillFormData,
  MemoryFormData,
  isHostMessage,
} from "../shared/messages";
import { markdownBodyField } from "./markdownBody";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root") as HTMLElement;

let current: FormData | null = null;
/** Working copy of memory entries (mutated as the user adds/removes blocks). */
let memoryEntries: string[] = [];

function openFile(path: string): void {
  vscode.postMessage({ type: "openFile", path });
}

// Restore any state VS Code retained across a reload before the host replies.
const saved = vscode.getState();
if (saved && typeof saved === "object") {
  current = saved as FormData;
  render();
}

window.addEventListener("message", (event: MessageEvent) => {
  const message: unknown = event.data;
  if (!isHostMessage(message)) {
    console.warn("harnextai webview: dropped invalid host message", message);
    return;
  }
  handle(message);
});

function handle(message: HostMessage): void {
  switch (message.type) {
    case "state":
      current = message.data;
      vscode.setState(current);
      render();
      break;
    case "saved":
      flashStatus("Saved.", false);
      break;
    case "error":
      flashStatus(message.message, true);
      break;
  }
}

// -- small DOM helpers -------------------------------------------------------

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

function field(
  labelText: string,
  control: HTMLElement,
  hint?: string,
): HTMLElement {
  const parts: (Node | string)[] = [
    el("label", { className: "field-label" }, [labelText]),
    control,
  ];
  if (hint) {
    parts.push(el("p", { className: "hint" }, [hint]));
  }
  return el("div", { className: "field" }, parts);
}

let statusEl: HTMLElement | null = null;
function flashStatus(text: string, isError: boolean): void {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = text;
  statusEl.className = isError ? "status status-error" : "status status-ok";
}

// -- rendering ---------------------------------------------------------------

function render(): void {
  root.textContent = "";
  if (!current) {
    root.append(el("p", { className: "hint" }, ["Select an item to edit."]));
    return;
  }
  switch (current.kind) {
    case "agent":
      renderAgent(current);
      break;
    case "skill":
      renderSkill(current);
      break;
    case "memory":
      renderMemory(current);
      break;
  }
}

function renderAgent(data: AgentFormData): void {
  const name = el("input", {
    className: "text-input",
    type: "text",
    value: data.name,
  });
  const description = el("textarea", {
    className: "textarea",
    rows: 3,
    value: data.description,
  });
  const model = el("input", {
    className: "text-input",
    type: "text",
    value: data.model,
  });
  const tools = el("input", {
    className: "text-input",
    type: "text",
    value: data.tools,
  });
  const body = markdownBodyField(
    "System prompt (markdown body)",
    data.body,
    openFile,
  );

  const save = saveButton(() => {
    const next: AgentFormData = {
      kind: "agent",
      filePath: data.filePath,
      name: name.value,
      description: description.value,
      model: model.value,
      tools: tools.value,
      body: body.textarea.value,
    };
    submit(next);
  });

  root.append(
    heading("Agent", data.filePath),
    field("name", name),
    field("description", description),
    field("model", model, "e.g. opus, sonnet, haiku"),
    field("tools", tools, "Comma-separated; leave blank to inherit all tools."),
    body.root,
    footer(save),
  );
}

function renderSkill(data: SkillFormData): void {
  const name = el("input", {
    className: "text-input",
    type: "text",
    value: data.name,
  });
  const description = el("textarea", {
    className: "textarea",
    rows: 3,
    value: data.description,
  });
  const disable = el("input", { type: "checkbox" });
  disable.checked = data.disableModelInvocation;
  const body = markdownBodyField("Skill body (markdown)", data.body, openFile);

  const disableField = el("div", { className: "field checkbox-field" }, [
    disable,
    el("label", { className: "field-label inline" }, [
      "disable-model-invocation",
    ]),
    el("p", { className: "hint" }, [
      "When checked, the model cannot auto-invoke this skill.",
    ]),
  ]);

  const save = saveButton(() => {
    const next: SkillFormData = {
      kind: "skill",
      filePath: data.filePath,
      name: name.value,
      description: description.value,
      disableModelInvocation: disable.checked,
      body: body.textarea.value,
    };
    submit(next);
  });

  root.append(
    heading("Skill", data.filePath),
    field("name", name),
    field("description", description),
    disableField,
    body.root,
    footer(save),
  );
}

function renderMemory(data: MemoryFormData): void {
  memoryEntries = [...data.entries];

  const list = el("div", { className: "entries" });
  const counter = el("span", { className: "counter" });

  const recount = (): void => {
    const used = memoryEntries.join("\n---\n").length;
    counter.textContent = `${used} / ${data.budget} chars`;
    counter.className = used > data.budget ? "counter over" : "counter";
  };

  const rebuild = (): void => {
    list.textContent = "";
    memoryEntries.forEach((entry, index) => {
      const body = markdownBodyField("", entry, openFile, {
        rows: 4,
        className: "textarea entry",
      });
      body.textarea.addEventListener("input", () => {
        memoryEntries[index] = body.textarea.value;
        recount();
      });
      const remove = el(
        "button",
        { className: "btn btn-ghost", type: "button" },
        ["Remove"],
      );
      remove.addEventListener("click", () => {
        memoryEntries.splice(index, 1);
        rebuild();
        recount();
      });
      list.append(
        el("div", { className: "entry-row" }, [
          el("div", { className: "entry-head" }, [
            el("span", { className: "entry-num" }, [`Entry ${index + 1}`]),
            remove,
          ]),
          body.root,
        ]),
      );
    });
  };
  rebuild();
  recount();

  const add = el("button", { className: "btn", type: "button" }, [
    "+ Add entry",
  ]);
  add.addEventListener("click", () => {
    memoryEntries.push("");
    rebuild();
    recount();
  });

  const save = saveButton(() => {
    const next: MemoryFormData = {
      kind: "memory",
      filePath: data.filePath,
      label: data.label,
      budget: data.budget,
      entries: memoryEntries,
    };
    submit(next);
  });

  root.append(
    heading("Memory", data.filePath),
    el("div", { className: "memory-meta" }, [counter]),
    el("p", { className: "hint" }, [
      "Budget is advisory — you can save over it, but consolidate soon (see the memory protocol).",
    ]),
    list,
    el("div", { className: "memory-actions" }, [add]),
    footer(save),
  );
}

// -- shared pieces -----------------------------------------------------------

function heading(kind: string, filePath: string): HTMLElement {
  return el("header", { className: "panel-head" }, [
    el("h1", { className: "panel-title" }, [kind]),
    el("code", { className: "panel-path" }, [filePath]),
  ]);
}

function saveButton(onClick: () => void): HTMLButtonElement {
  const btn = el("button", { className: "btn btn-primary", type: "button" }, [
    "Save",
  ]);
  btn.addEventListener("click", onClick);
  return btn;
}

function footer(save: HTMLElement): HTMLElement {
  statusEl = el("span", { className: "status" });
  return el("div", { className: "footer" }, [save, statusEl]);
}

function submit(data: FormData): void {
  current = data;
  vscode.setState(current);
  vscode.postMessage({ type: "save", data });
  flashStatus("Saving…", false);
}

// Announce readiness so the host pushes the authoritative state.
vscode.postMessage({ type: "ready" });
