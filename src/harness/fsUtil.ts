import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** List `*.md` basenames (without extension) in a directory. */
export async function listMdNames(dir: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = await readdir(dir);
  return entries
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

/** Recursively walk a directory, returning relative file paths. */
export async function walkFiles(
  rootDir: string,
  relativeDir = "",
): Promise<string[]> {
  const abs = join(rootDir, relativeDir);
  if (!existsSync(abs)) {
    return [];
  }
  const out: string[] = [];
  const entries = await readdir(abs, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relativeDir ? join(relativeDir, entry.name) : entry.name;
    const full = join(rootDir, rel);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(rootDir, rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    } else {
      const st = await stat(full).catch(() => null);
      if (st?.isFile()) {
        out.push(rel);
      }
    }
  }
  return out;
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}
