import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface InitHooksResult {
  installed: string[];
  skipped: boolean;
}

/** Install versioned hooks from .harness/hooks/ into .git/hooks/. */
export async function installHarnessHooks(
  root: string,
): Promise<InitHooksResult> {
  const hooksSrc = join(root, ".harness", "hooks");
  const hooksDest = join(root, ".git", "hooks");

  if (!existsSync(hooksSrc)) {
    return { installed: [], skipped: true };
  }
  if (!existsSync(join(root, ".git"))) {
    return { installed: [], skipped: true };
  }

  await mkdir(hooksDest, { recursive: true });
  const names = await readdir(hooksSrc);
  const installed: string[] = [];
  for (const name of names) {
    const src = join(hooksSrc, name);
    const dest = join(hooksDest, name);
    await copyFile(src, dest);
    await chmod(dest, 0o755);
    installed.push(`.git/hooks/${name}`);
  }
  return { installed, skipped: false };
}
