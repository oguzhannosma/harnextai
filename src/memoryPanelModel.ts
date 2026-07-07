import { promises as fs } from "node:fs";
import { parseMemory, computeUsed, loadMemoryFiles } from "./memoryStore";
import type { MemoryPanelSection, MemoryPanelView } from "./shared/messages";

/**
 * Data assembly for the live memory panel. Reuses the same parse/used logic as
 * the memory editor ({@link file://./memoryStore.ts}) so the panel and the form
 * agree on budget accounting. Pure Node (no `vscode`) and the per-file assembly
 * is split from I/O so it is unit-testable against fixture content.
 */

/** Build one panel section from a file's raw content. Pure. */
export function buildSection(
  label: string,
  filePath: string,
  content: string,
  defaultBudget: number,
): MemoryPanelSection {
  const { budget, entries } = parseMemory(content, defaultBudget);
  const used = computeUsed(entries);
  return {
    label,
    filePath,
    budget,
    used,
    overBudget: used > budget,
    entries,
  };
}

/**
 * Assemble the full panel view: every personal `.harness/memories/*.md` plus the
 * team memory file (via the same enumeration the tree uses), each read and parsed
 * into a section. A file that vanishes between enumeration and read is skipped,
 * never thrown.
 */
export async function loadMemoryPanel(
  memoriesDir: string,
  teamMemoryPath: string,
): Promise<MemoryPanelView> {
  const refs = await loadMemoryFiles(memoriesDir, teamMemoryPath);
  const sections: MemoryPanelSection[] = [];
  for (const ref of refs) {
    let content: string;
    try {
      content = await fs.readFile(ref.filePath, "utf8");
    } catch {
      continue; // removed between enumeration and read — skip
    }
    sections.push(
      buildSection(ref.label, ref.filePath, content, ref.defaultBudget),
    );
  }
  return { sections };
}
