import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export interface GitResult {
  code: number;
  out: string;
  err: string;
}

export async function git(root: string, ...args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await pExecFile("git", args, {
      cwd: root,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { code: 0, out: stdout, err: stderr };
  } catch (err: unknown) {
    if (err && typeof err === "object") {
      const e = err as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      if (typeof e.code === "number") {
        return {
          code: e.code,
          out: typeof e.stdout === "string" ? e.stdout : "",
          err:
            typeof e.stderr === "string" ? e.stderr : String(e.message ?? err),
        };
      }
    }
    return {
      code: 127,
      out: "",
      err: `git not available: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
