// Harness dashboard UI — vanilla TS. Tabs: Agents / Skills / Hooks / Memory / Approvals.
type Doc = { name: string; frontmatter: Record<string, string>; body: string };
type Hook = { name: string; body: string };
type MemFile = { path: string; title: string };

const app = document.getElementById("app")!;
const MODELS = ["inherit", "haiku", "sonnet", "opus"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok)
    throw new Error(
      ((await res.json().catch(() => ({}))) as any).error ?? res.statusText,
    );
  return res.json();
}

let toastEl: HTMLElement;
function toast(msg: string, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = isError ? "error show" : "show";
  setTimeout(() => (toastEl.className = ""), 2200);
}

// ---------- generic doc editor (agents & skills) ----------
function docEditor(
  kind: "agents" | "skills" | "commands",
  docs: Doc[],
  selected: string | null,
  detail: HTMLElement,
  list: HTMLElement,
  refresh: () => void,
) {
  list.innerHTML = "";
  for (const d of docs) {
    const tag =
      kind === "agents"
        ? (d.frontmatter.model ?? "inherit")
        : kind === "commands"
          ? "user"
          : d.frontmatter["disable-model-invocation"] === "true"
            ? "user"
            : "model";
    const item = document.createElement("div");
    item.className = "item" + (d.name === selected ? " active" : "");
    item.innerHTML = `<span>${d.name}</span><span class="tag">${tag}</span>`;
    item.onclick = () => render(kind, d.name);
    list.appendChild(item);
  }
  const add = document.createElement("button");
  add.className = "add";
  add.textContent = `+ new ${kind.slice(0, -1)}`;
  add.onclick = async () => {
    const name = prompt(`New ${kind.slice(0, -1)} name (kebab-case):`)?.trim();
    if (!name || !/^[\w-]+$/.test(name)) return;
    await api(`${kind}/${name}`, {
      method: "POST",
      body: JSON.stringify({
        frontmatter: { name, description: "TODO — describe when to use this." },
        body: "TODO",
      }),
    });
    toast(`${name} created`);
    render(kind, name);
  };
  list.appendChild(add);

  const doc = docs.find((d) => d.name === selected);
  detail.innerHTML = "";
  if (!doc) {
    detail.innerHTML = `<div class="placeholder">Select or create ${kind === "agents" ? "an agent" : "a " + kind.slice(0, -1)}. Sources live in .harness/; .claude/ stubs regenerate on save.</div>`;
    return;
  }
  const fm = { ...doc.frontmatter };
  const row = document.createElement("div");
  row.className = "row";
  const mkInput = (
    key: string,
    labelText: string,
    el: HTMLInputElement | HTMLSelectElement,
  ) => {
    const label = document.createElement("label");
    label.textContent = labelText;
    el.onchange = () => (fm[key] = (el as HTMLInputElement).value);
    label.appendChild(el);
    row.appendChild(label);
  };
  const nameIn = document.createElement("input");
  nameIn.value = fm.name ?? doc.name;
  mkInput("name", "name", nameIn);
  const descIn = document.createElement("input");
  descIn.value = fm.description ?? "";
  mkInput("description", "description (invocation trigger)", descIn);
  if (kind === "agents") {
    const sel = document.createElement("select");
    sel.innerHTML = MODELS.map(
      (m) =>
        `<option ${m === (fm.model ?? "inherit") ? "selected" : ""}>${m}</option>`,
    ).join("");
    mkInput("model", "model", sel);
    const toolsIn = document.createElement("input");
    toolsIn.value = fm.tools ?? "";
    toolsIn.placeholder = "empty = all tools";
    mkInput("tools", "tools", toolsIn);
  } else if (kind === "commands") {
    const argIn = document.createElement("input");
    argIn.value = fm["argument-hint"] ?? "";
    argIn.placeholder = "e.g. [scope]";
    mkInput("argument-hint", "argument hint", argIn);
  } else {
    const sel = document.createElement("select");
    const cur = fm["disable-model-invocation"] === "true";
    sel.innerHTML = `<option value="" ${!cur ? "selected" : ""}>model-invoked</option><option value="true" ${cur ? "selected" : ""}>user-invoked</option>`;
    mkInput("disable-model-invocation", "invocation", sel);
  }
  detail.appendChild(row);

  const bodyTa = document.createElement("textarea");
  bodyTa.className = "body";
  bodyTa.value = doc.body.trim();
  detail.appendChild(bodyTa);

  const actions = document.createElement("div");
  actions.className = "actions";
  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Save";
  save.onclick = async () => {
    await api(`${kind}/${doc.name}`, {
      method: "PUT",
      body: JSON.stringify({ frontmatter: fm, body: bodyTa.value + "\n" }),
    });
    toast("saved");
    refresh();
  };
  const del = document.createElement("button");
  del.className = "danger";
  del.textContent = "Delete";
  del.onclick = async () => {
    if (!confirm(`Delete ${doc.name}? This removes the file on disk.`)) return;
    await api(`${kind}/${doc.name}`, { method: "DELETE" });
    toast(`${doc.name} deleted`);
    render(kind, null);
  };
  actions.append(save, del);
  detail.appendChild(actions);
}

// ---------- hooks tab ----------
function hooksView(
  hooks: Hook[],
  selected: string | null,
  detail: HTMLElement,
  list: HTMLElement,
) {
  list.innerHTML = "";
  for (const h of hooks) {
    const item = document.createElement("div");
    item.className = "item" + (h.name === selected ? " active" : "");
    item.innerHTML = `<span>${h.name}</span>`;
    item.onclick = () => render("hooks", h.name);
    list.appendChild(item);
  }
  const add = document.createElement("button");
  add.className = "add";
  add.textContent = "+ new hook";
  add.onclick = async () => {
    const name = prompt("Hook name (e.g. pre-rebase):")?.trim();
    if (!name || !/^[\w-]+$/.test(name)) return;
    await api(`hooks/${name}`, {
      method: "POST",
      body: JSON.stringify({ body: "# husky hook\n" }),
    });
    render("hooks", name);
  };
  list.appendChild(add);

  const hook = hooks.find((h) => h.name === selected);
  detail.innerHTML = "";
  if (!hook) {
    detail.innerHTML = `<div class="placeholder">Husky hooks in .husky/ — select one to edit.</div>`;
    return;
  }
  const ta = document.createElement("textarea");
  ta.className = "body";
  ta.value = hook.body;
  detail.appendChild(ta);
  const actions = document.createElement("div");
  actions.className = "actions";
  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Save";
  save.onclick = async () => {
    await api(`hooks/${hook.name}`, {
      method: "PUT",
      body: JSON.stringify({ body: ta.value }),
    });
    toast("saved");
  };
  const del = document.createElement("button");
  del.className = "danger";
  del.textContent = "Delete";
  del.onclick = async () => {
    if (!confirm(`Delete hook ${hook.name}?`)) return;
    await api(`hooks/${hook.name}`, { method: "DELETE" });
    render("hooks", null);
  };
  actions.append(save, del);
  detail.appendChild(actions);
}

// ---------- memory tab: browser + wikilink graph ----------
async function memoryView(container: HTMLElement, selectedPath: string | null) {
  const files = await api<MemFile[]>("memory");
  const contents = new Map<string, string>();
  await Promise.all(
    files.map(async (f) => {
      const r = await api<{ body: string }>(
        `memory/file?path=${encodeURIComponent(f.path)}`,
      );
      contents.set(f.path, r.body);
    }),
  );
  // wikilink edges by note title
  const byTitle = new Map(files.map((f) => [f.title.toLowerCase(), f.path]));
  const edges: [string, string][] = [];
  for (const f of files) {
    for (const m of (contents.get(f.path) ?? "").matchAll(
      /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g,
    )) {
      const target = byTitle.get(m[1].trim().toLowerCase());
      if (target && target !== f.path) edges.push([f.path, target]);
    }
  }

  container.innerHTML = `<div class="memory-layout">
    <div class="list" id="mem-list"></div>
    <div class="memory-main">
      <div class="actions"><strong id="mem-title" style="font-size:0.9rem"></strong>
        <button class="ghost" id="mem-edit" style="margin-left:auto">Edit</button></div>
      <pre id="mem-body"></pre>
      <canvas id="graph" height="220"></canvas>
    </div></div>`;
  const list = container.querySelector("#mem-list") as HTMLElement;
  const bodyEl = container.querySelector("#mem-body") as HTMLElement;
  const titleEl = container.querySelector("#mem-title") as HTMLElement;
  const editBtn = container.querySelector("#mem-edit") as HTMLButtonElement;

  const sel =
    selectedPath && contents.has(selectedPath)
      ? selectedPath
      : (files[0]?.path ?? null);
  for (const f of files) {
    const item = document.createElement("div");
    item.className = "item" + (f.path === sel ? " active" : "");
    const zone = f.path.split("/")[1];
    item.innerHTML = `<span>${f.title}</span><span class="tag">${zone}</span>`;
    item.onclick = () => render("memory", f.path);
    list.appendChild(item);
  }
  if (!sel) {
    bodyEl.textContent = "No memory files yet.";
    return;
  }
  titleEl.textContent = sel;
  // render body with clickable wikilinks
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  bodyEl.innerHTML = esc(contents.get(sel) ?? "").replace(
    /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g,
    (_, t, alias) =>
      `<span class="wikilink" data-t="${t.trim().toLowerCase()}">${alias ?? t}</span>`,
  );
  bodyEl.querySelectorAll(".wikilink").forEach((el) =>
    el.addEventListener("click", () => {
      const target = byTitle.get((el as HTMLElement).dataset.t!);
      if (target) render("memory", target);
    }),
  );
  editBtn.onclick = async () => {
    const cur = contents.get(sel) ?? "";
    const ta = document.createElement("textarea");
    ta.className = "body";
    ta.value = cur;
    bodyEl.replaceWith(ta);
    editBtn.textContent = "Save";
    editBtn.onclick = async () => {
      await api(`memory/file?path=${encodeURIComponent(sel)}`, {
        method: "PUT",
        body: JSON.stringify({ body: ta.value }),
      });
      toast("saved");
      render("memory", sel);
    };
  };

  // force-directed wikilink graph
  const canvas = container.querySelector("#graph") as HTMLCanvasElement;
  canvas.width = canvas.parentElement!.clientWidth;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width,
    H = canvas.height;
  const nodes = files.map((f, i) => ({
    f,
    x: W / 2 + Math.cos((i / files.length) * 6.283) * H * 0.35,
    y: H / 2 + Math.sin((i / files.length) * 6.283) * H * 0.35,
    vx: 0,
    vy: 0,
  }));
  const idx = new Map(files.map((f, i) => [f.path, i]));
  for (let it = 0; it < 200; it++) {
    for (const a of nodes)
      for (const b of nodes) {
        if (a === b) continue;
        const dx = a.x - b.x,
          dy = a.y - b.y,
          d2 = Math.max(dx * dx + dy * dy, 25);
        a.vx += (dx / d2) * 600;
        a.vy += (dy / d2) * 600;
      }
    for (const [s, t] of edges) {
      const a = nodes[idx.get(s)!],
        b = nodes[idx.get(t)!];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      a.vx += dx * 0.01;
      a.vy += dy * 0.01;
      b.vx -= dx * 0.01;
      b.vy -= dy * 0.01;
    }
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.002;
      n.vy += (H / 2 - n.y) * 0.002;
      n.x = Math.min(W - 15, Math.max(15, n.x + n.vx * 0.5));
      n.y = Math.min(H - 15, Math.max(15, n.y + n.vy * 0.5));
      n.vx *= 0.6;
      n.vy *= 0.6;
    }
  }
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "#2b3040";
  for (const [s, t] of edges) {
    const a = nodes[idx.get(s)!],
      b = nodes[idx.get(t)!];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const n of nodes) {
    ctx.beginPath();
    ctx.fillStyle = n.f.path === sel ? "#6c8cff" : "#8a91a3";
    ctx.arc(n.x, n.y, n.f.path === sel ? 6 : 4, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "#d8dce6";
    ctx.font = "10px sans-serif";
    ctx.fillText(n.f.title, n.x + 8, n.y + 3);
  }
  canvas.onclick = (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left,
      y = ev.clientY - r.top;
    const hit = nodes.find((n) => (n.x - x) ** 2 + (n.y - y) ** 2 < 100);
    if (hit) render("memory", hit.f.path);
  };
}

// ---------- approvals tab ----------
async function approvalsView(container: HTMLElement) {
  const pending = await api<{ name: string; body: string }[]>("pending");
  container.innerHTML = `<div class="detail" style="gap:1rem"></div>`;
  const box = container.firstElementChild as HTMLElement;
  if (!pending.length) {
    box.innerHTML = `<div class="placeholder">No pending team-memory proposals. Agents file them to .harness/team-memories/.pending/.</div>`;
    return;
  }
  for (const pr of pending) {
    const card = document.createElement("div");
    card.className = "pending-card";
    card.innerHTML = `<h3>${pr.name}</h3><pre>${pr.body.replace(/</g, "&lt;")}</pre>`;
    const actions = document.createElement("div");
    actions.className = "actions";
    const approve = document.createElement("button");
    approve.className = "primary";
    approve.textContent = "Approve → team.md";
    approve.onclick = async () => {
      await api(`pending/${pr.name}/approve`, { method: "POST", body: "{}" });
      toast("merged into team memory");
      render("approvals", null);
    };
    const reject = document.createElement("button");
    reject.className = "danger";
    reject.textContent = "Reject";
    reject.onclick = async () => {
      await api(`pending/${pr.name}/reject`, { method: "POST" });
      toast("rejected");
      render("approvals", null);
    };
    actions.append(approve, reject);
    card.appendChild(actions);
    box.appendChild(card);
  }
}

// ---------- shell ----------
const TABS = [
  "agents",
  "skills",
  "commands",
  "hooks",
  "memory",
  "approvals",
] as const;
type Tab = (typeof TABS)[number];
let current: Tab = "agents";

async function render(tab: Tab, selected: string | null) {
  current = tab;
  app.innerHTML = `
    <header><h1><span>intelligents</span> · harness dashboard</h1><nav></nav></header>
    <main></main><div id="toast"></div>`;
  toastEl = document.getElementById("toast")!;
  const nav = app.querySelector("nav")!;
  const pendingCount =
    tab === "approvals"
      ? 0
      : (await api<unknown[]>("pending").catch(() => [])).length;
  for (const t of TABS) {
    const b = document.createElement("button");
    b.className = t === tab ? "active" : "";
    b.innerHTML =
      t[0].toUpperCase() +
      t.slice(1) +
      (t === "approvals" && pendingCount
        ? ` <span class="badge">${pendingCount}</span>`
        : "");
    b.onclick = () => render(t, null);
    nav.appendChild(b);
  }
  const main = app.querySelector("main")!;
  try {
    if (tab === "memory")
      return void (await memoryView(main as HTMLElement, selected));
    if (tab === "approvals")
      return void (await approvalsView(main as HTMLElement));
    main.innerHTML = `<div class="list"></div><div class="detail"></div>`;
    const list = main.querySelector(".list") as HTMLElement;
    const detail = main.querySelector(".detail") as HTMLElement;
    if (tab === "hooks")
      return hooksView(await api<Hook[]>("hooks"), selected, detail, list);
    docEditor(tab, await api<Doc[]>(tab), selected, detail, list, () =>
      render(tab, selected),
    );
  } catch (e) {
    main.innerHTML = `<div class="placeholder">Error: ${String(e)}</div>`;
  }
}

render("agents", null);
