export interface MemoryFile {
  budget: number;
  used: number;
  entries: string[];
}

const HEADER_RE = /^<!--\s*budget:\s*(\d+)\s*\|\s*used:\s*(\d+)\s*-->/;

export function hasValidHeader(raw: string): boolean {
  return HEADER_RE.test(raw.split(/\r?\n/)[0] ?? "");
}

export function parseMemoryFile(raw: string): MemoryFile {
  const lines = raw.split(/\r?\n/);
  const headerMatch = HEADER_RE.exec(lines[0] ?? "");
  const budget = headerMatch ? Number(headerMatch[1]) : 4000;
  const used = headerMatch ? Number(headerMatch[2]) : 0;
  const rest = (headerMatch ? lines.slice(1) : lines).join("\n");
  const entries = rest
    .split(/\n---\n/)
    .map((e) => e.trim())
    .filter(Boolean);
  return { budget, used, entries };
}

export function serializeMemoryFile(file: MemoryFile): string {
  const usedNow = file.entries.join("\n---\n").length;
  const header = `<!-- budget: ${file.budget} | used: ${usedNow} -->`;
  return `${header}\n${file.entries.join("\n---\n")}\n`;
}
