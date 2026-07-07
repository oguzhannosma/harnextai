// Harness dashboard server (Bun). Serves the built UI from dist/ and a file
// API over the real harness config files. Localhost only.
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  existsSync,
  statSync,
  appendFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
// Source-of-truth dirs — the `harness` CLI generates .claude/ stubs from these.
const AGENTS = join(ROOT, ".harness", "agents");
const SKILLS = join(ROOT, ".harness", "skills");
const COMMANDS = join(ROOT, ".harness", "commands");
const HOOKS = join(ROOT, ".husky");
const MEMORY_ROOTS = [
  ".harness/memories",
  ".harness/team-memories",
  ".harness/project-index",
];
const PENDING = join(ROOT, ".harness", "team-memories", ".pending");
const TEAM = join(ROOT, ".harness", "team-memories", "team.md");
const MANIFEST = join(ROOT, ".harness", "harness.json");

// --- tiny frontmatter codec (flat key: value — all our files use this shape) ---
function parseDoc(raw: string): { fm: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: m[2] };
}
function serializeDoc(fm: Record<string, string>, body: string): string {
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

const safeName = (n: string) => /^[\w-]+$/.test(n);
function inRoot(p: string): string {
  const abs = resolve(ROOT, p);
  if (!(abs === ROOT || abs.startsWith(ROOT + sep)))
    throw new Error("path escapes repo");
  return abs;
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

// After editing .harness/ sources, let the harness CLI regenerate .claude/ stubs
// and skill copies. Fire-and-forget; the CLI may be absent in CI.
function regenStubs() {
  try {
    Bun.spawn(["harness", "doctor", "--fix"], {
      cwd: ROOT,
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {}
}

// Keep harness.json's agents roster in sync so `harness doctor` stays clean.
function syncAgentRoster(name: string, present: boolean) {
  const config = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const agents: string[] = config.agents ?? [];
  if (present && !agents.includes(name)) agents.push(name);
  if (!present) config.agents = agents.filter((a: string) => a !== name);
  else config.agents = agents.sort();
  writeFileSync(MANIFEST, JSON.stringify(config, null, 2) + "\n");
}

// --- collection helpers: agents are files, skills are folders with SKILL.md ---
function listAgents() {
  if (!existsSync(AGENTS)) return [];
  return readdirSync(AGENTS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { fm, body } = parseDoc(readFileSync(join(AGENTS, f), "utf8"));
      return { name: f.replace(/\.md$/, ""), frontmatter: fm, body };
    });
}
function listSkills() {
  if (!existsSync(SKILLS)) return [];
  return readdirSync(SKILLS)
    .filter((d) => existsSync(join(SKILLS, d, "SKILL.md")))
    .map((d) => {
      const { fm, body } = parseDoc(
        readFileSync(join(SKILLS, d, "SKILL.md"), "utf8"),
      );
      return { name: d, frontmatter: fm, body };
    });
}
function listCommands() {
  if (!existsSync(COMMANDS)) return [];
  return readdirSync(COMMANDS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { fm, body } = parseDoc(readFileSync(join(COMMANDS, f), "utf8"));
      return { name: f.replace(/\.md$/, ""), frontmatter: fm, body };
    });
}
function listHooks() {
  if (!existsSync(HOOKS)) return [];
  return readdirSync(HOOKS)
    .filter(
      (f) =>
        !f.startsWith("_") &&
        !f.startsWith(".") &&
        statSync(join(HOOKS, f)).isFile(),
    )
    .map((f) => ({ name: f, body: readFileSync(join(HOOKS, f), "utf8") }));
}
function memoryTree() {
  const files: { path: string; title: string }[] = [];
  const walk = (rel: string) => {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const relPath = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(relPath);
      else if (e.name.endsWith(".md"))
        files.push({ path: relPath, title: e.name.replace(/\.md$/, "") });
    }
  };
  MEMORY_ROOTS.forEach(walk);
  return files;
}

Bun.serve({
  hostname: "127.0.0.1",
  port: 5175,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith("/api/")) {
        // manifest
        if (p === "/api/manifest" && req.method === "GET")
          return json(JSON.parse(readFileSync(MANIFEST, "utf8")));
        if (p === "/api/manifest" && req.method === "PUT")
          return (
            writeFileSync(
              MANIFEST,
              JSON.stringify(await req.json(), null, 2) + "\n",
            ),
            json({ ok: true })
          );

        // agents, commands & skills share CRUD shape over .harness/ sources
        for (const [base, kind] of [
          ["/api/agents", "agent"],
          ["/api/skills", "skill"],
          ["/api/commands", "command"],
        ] as const) {
          if (!p.startsWith(base)) continue;
          const rest = p.slice(base.length).replace(/^\//, "");
          if (req.method === "GET" && !rest)
            return json(
              kind === "agent"
                ? listAgents()
                : kind === "skill"
                  ? listSkills()
                  : listCommands(),
            );
          if (!safeName(rest)) return json({ error: "bad name" }, 400);
          const dir =
            kind === "agent"
              ? AGENTS
              : kind === "command"
                ? COMMANDS
                : join(SKILLS, rest);
          const file =
            kind === "skill" ? join(dir, "SKILL.md") : join(dir, `${rest}.md`);
          if (req.method === "PUT" || req.method === "POST") {
            const { frontmatter, body } = (await req.json()) as {
              frontmatter: Record<string, string>;
              body: string;
            };
            mkdirSync(dir, { recursive: true });
            writeFileSync(file, serializeDoc(frontmatter, body ?? ""));
            if (kind === "agent") syncAgentRoster(rest, true);
            regenStubs();
            return json({ ok: true });
          }
          if (req.method === "DELETE") {
            rmSync(kind === "skill" ? dir : file, {
              recursive: true,
              force: true,
            });
            if (kind === "agent") syncAgentRoster(rest, false);
            regenStubs();
            return json({ ok: true });
          }
        }

        // hooks
        if (p.startsWith("/api/hooks")) {
          const name = p.slice("/api/hooks".length).replace(/^\//, "");
          if (req.method === "GET" && !name) return json(listHooks());
          if (!safeName(name)) return json({ error: "bad name" }, 400);
          const file = join(HOOKS, name);
          if (req.method === "PUT" || req.method === "POST")
            return (
              writeFileSync(
                file,
                ((await req.json()) as { body: string }).body,
              ),
              json({ ok: true })
            );
          if (req.method === "DELETE")
            return (rmSync(file, { force: true }), json({ ok: true }));
        }

        // memory vault
        if (p === "/api/memory" && req.method === "GET")
          return json(memoryTree());
        if (p === "/api/memory/file") {
          const rel = url.searchParams.get("path") ?? "";
          if (!MEMORY_ROOTS.some((r) => rel.startsWith(r)))
            return json({ error: "outside vault" }, 400);
          const abs = inRoot(rel);
          if (req.method === "GET")
            return json({
              path: rel,
              body: existsSync(abs) ? readFileSync(abs, "utf8") : "",
            });
          if (req.method === "PUT")
            return (
              writeFileSync(abs, ((await req.json()) as { body: string }).body),
              json({ ok: true })
            );
        }

        // team-memory approval queue
        if (p === "/api/pending" && req.method === "GET") {
          if (!existsSync(PENDING)) return json([]);
          return json(
            readdirSync(PENDING)
              .filter((f) => f.endsWith(".md"))
              .map((f) => ({
                name: f,
                body: readFileSync(join(PENDING, f), "utf8"),
              })),
          );
        }
        const pm = p.match(/^\/api\/pending\/([\w.-]+)\/(approve|reject)$/);
        if (pm && req.method === "POST") {
          const file = join(PENDING, pm[1]);
          if (!existsSync(file)) return json({ error: "not found" }, 404);
          if (pm[2] === "approve") {
            const entry =
              ((await req.json().catch(() => ({}))) as { entry?: string })
                .entry ?? readFileSync(file, "utf8").trim();
            appendFileSync(TEAM, `\n---\n${entry}\n`);
          }
          rmSync(file);
          return json({ ok: true });
        }
        return json({ error: "not found" }, 404);
      }

      // static UI from dist/
      const distPath = join(
        import.meta.dir,
        "dist",
        p === "/" ? "index.html" : p.slice(1),
      );
      const f = Bun.file(distPath);
      if (await f.exists()) return new Response(f);
      return new Response(
        Bun.file(join(import.meta.dir, "dist", "index.html")),
      );
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
});
console.log("harness dashboard → http://127.0.0.1:5175");
