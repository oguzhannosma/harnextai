/**
 * Dual-view (Text | Preview) control for markdown body fields, plus a small
 * dependency-free markdown → DOM renderer. Never uses `innerHTML` — only
 * createElement / textContent (webview-ui skill). File-path references become
 * clickable links that post `openFile` to the extension host.
 */
import { BARE_FILE_PATH_RE, isFilePathRef } from "../shared/filePaths";

export type OpenFileFn = (path: string) => void;

/** Build a Text/Preview body field. `getValue` / edits stay on the textarea. */
export function markdownBodyField(
  labelText: string,
  initial: string,
  openFile: OpenFileFn,
  options: { rows?: number; className?: string } = {},
): { root: HTMLElement; textarea: HTMLTextAreaElement } {
  const textarea = document.createElement("textarea");
  textarea.className = options.className ?? "textarea body";
  textarea.rows = options.rows ?? 18;
  textarea.value = initial;

  const preview = document.createElement("div");
  preview.className = "md-preview";
  preview.hidden = true;

  const textTab = tabButton("Text", true);
  const previewTab = tabButton("Preview", false);

  const setMode = (mode: "text" | "preview"): void => {
    const isText = mode === "text";
    textarea.hidden = !isText;
    preview.hidden = isText;
    textTab.classList.toggle("active", isText);
    previewTab.classList.toggle("active", !isText);
    textTab.setAttribute("aria-selected", String(isText));
    previewTab.setAttribute("aria-selected", String(!isText));
    if (!isText) {
      renderMarkdownPreview(preview, textarea.value, openFile);
    }
  };

  textTab.addEventListener("click", () => setMode("text"));
  previewTab.addEventListener("click", () => setMode("preview"));

  const tabs = document.createElement("div");
  tabs.className = "md-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.append(textTab, previewTab);

  const root = document.createElement("div");
  root.className = "field md-body-field";
  if (labelText) {
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = labelText;
    root.append(label);
  }
  root.append(tabs, textarea, preview);

  return { root, textarea };
}

function tabButton(label: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = active ? "md-tab active" : "md-tab";
  btn.textContent = label;
  btn.setAttribute("role", "tab");
  btn.setAttribute("aria-selected", String(active));
  return btn;
}

/** Render markdown into `container` using safe DOM nodes only. */
export function renderMarkdownPreview(
  container: HTMLElement,
  source: string,
  openFile: OpenFileFn,
): void {
  container.textContent = "";
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.trim()) {
    const empty = document.createElement("p");
    empty.className = "md-empty";
    empty.textContent = "(empty)";
    container.append(empty);
    return;
  }

  const lines = normalized.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // closing fence
      const pre = document.createElement("pre");
      pre.className = "md-codeblock";
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      container.append(pre);
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1]!.length, 6);
      const h = document.createElement(`h${level}` as "h1");
      h.className = "md-heading";
      appendInline(h, heading[2] ?? "", openFile);
      container.append(h);
      i += 1;
      continue;
    }

    // Unordered list run
    if (/^[-*+]\s+/.test(line)) {
      const ul = document.createElement("ul");
      ul.className = "md-list";
      while (i < lines.length && /^[-*+]\s+/.test(lines[i] ?? "")) {
        const li = document.createElement("li");
        appendInline(li, (lines[i] ?? "").replace(/^[-*+]\s+/, ""), openFile);
        ul.append(li);
        i += 1;
      }
      container.append(ul);
      continue;
    }

    // Ordered list run
    if (/^\d+\.\s+/.test(line)) {
      const ol = document.createElement("ol");
      ol.className = "md-list";
      while (i < lines.length && /^\d+\.\s+/.test(lines[i] ?? "")) {
        const li = document.createElement("li");
        appendInline(li, (lines[i] ?? "").replace(/^\d+\.\s+/, ""), openFile);
        ol.append(li);
        i += 1;
      }
      container.append(ol);
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-special lines
    const paraLines: string[] = [];
    while (i < lines.length) {
      const L = lines[i] ?? "";
      if (
        L.trim() === "" ||
        /^```/.test(L) ||
        /^#{1,6}\s+/.test(L) ||
        /^[-*+]\s+/.test(L) ||
        /^\d+\.\s+/.test(L)
      ) {
        break;
      }
      paraLines.push(L);
      i += 1;
    }
    const p = document.createElement("p");
    p.className = "md-p";
    appendInline(p, paraLines.join(" "), openFile);
    container.append(p);
  }
}

/**
 * Inline markdown: `code`, **bold**, *italic*, [text](href), and bare file
 * paths. Builds DOM nodes; never concatenates HTML strings.
 */
function appendInline(
  parent: HTMLElement,
  text: string,
  openFile: OpenFileFn,
): void {
  // Tokenize with a single pass over competing patterns.
  const re =
    /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|(_([^_]+)_))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      appendPlainWithPaths(parent, text.slice(last, m.index), openFile);
    }
    if (m[2] !== undefined && m[3] !== undefined) {
      // [text](href)
      const label = m[2];
      const href = m[3].trim();
      if (isFilePathRef(href)) {
        parent.append(fileLink(label, href, openFile));
      } else {
        const span = document.createElement("span");
        span.className = "md-link-text";
        span.textContent = label;
        if (href && href !== label) {
          span.title = href;
        }
        parent.append(span);
      }
    } else if (m[4] !== undefined) {
      const code = document.createElement("code");
      code.className = "md-inline-code";
      const inner = m[4];
      if (isFilePathRef(inner)) {
        code.append(fileLink(inner, inner, openFile));
      } else {
        code.textContent = inner;
      }
      parent.append(code);
    } else if (m[5] !== undefined) {
      const strong = document.createElement("strong");
      appendPlainWithPaths(strong, m[5], openFile);
      parent.append(strong);
    } else if (m[6] !== undefined || m[8] !== undefined) {
      const em = document.createElement("em");
      appendPlainWithPaths(em, m[6] ?? m[8] ?? "", openFile);
      parent.append(em);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    appendPlainWithPaths(parent, text.slice(last), openFile);
  }
}

function appendPlainWithPaths(
  parent: HTMLElement,
  text: string,
  openFile: OpenFileFn,
): void {
  if (!text) {
    return;
  }
  const re = new RegExp(BARE_FILE_PATH_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[0];
    if (!isFilePathRef(path)) {
      continue;
    }
    if (m.index > last) {
      parent.append(document.createTextNode(text.slice(last, m.index)));
    }
    parent.append(fileLink(path, path, openFile));
    last = m.index + path.length;
  }
  if (last < text.length) {
    parent.append(document.createTextNode(text.slice(last)));
  }
}

function fileLink(
  label: string,
  path: string,
  openFile: OpenFileFn,
): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "md-file-link";
  a.href = "#";
  a.textContent = label;
  a.title = `Open ${path}`;
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    openFile(path);
  });
  return a;
}
