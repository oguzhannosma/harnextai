/**
 * Heuristics for spotting file-path references in agent/skill markdown bodies.
 * Shared by the webview preview (to turn paths into clickable links) and unit
 * tests. Dependency-free — no `vscode`, no `node:*`.
 */

/** Extensions we treat as "this looks like a source/doc file". */
const FILE_EXT =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|html|htm|py|go|rs|toml|ya?ml|sh|ps1|bat|cmd|svg|png|jpg|jpeg|gif|webp|txt|map|lock)$/i;

/** Repo-relative prefixes that are almost always file paths even without an extension. */
const PATH_PREFIX =
  /^(?:\.\/|\.\.\/|\.harness\/|\.claude\/|\.cursor\/|\.github\/|src\/|docs\/|media\/|dist\/)/;

/**
 * True when `href` looks like a workspace/file path rather than an external URL
 * or in-page anchor. Used for markdown link targets and bare/backtick paths.
 */
export function isFilePathRef(href: string): boolean {
  const t = href.trim();
  if (!t || t.startsWith("#") || t.startsWith("mailto:")) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) {
    // scheme: — http:, https:, vscode:, file: (absolute file: handled by host)
    // Allow bare Windows drive paths like C:\... via a separate check below.
    if (!/^[a-zA-Z]:[\\/]/.test(t)) {
      return false;
    }
  }
  if (t.includes("://")) {
    return false;
  }
  const withoutFrag = t.split(/[#?]/)[0] ?? t;
  if (PATH_PREFIX.test(withoutFrag) || withoutFrag.includes("/")) {
    return true;
  }
  return FILE_EXT.test(withoutFrag);
}

/**
 * Match a likely file path token inside prose (not already inside a markdown
 * link). Conservative: requires a known prefix or a path-like segment with a
 * file extension.
 */
export const BARE_FILE_PATH_RE =
  /(?:\.\/|\.\.\/|\.harness\/|\.claude\/|\.cursor\/|\.github\/|src\/|docs\/|media\/|dist\/|[\w.@-]+\/)+[\w.@/-]+\.[a-zA-Z0-9]{1,10}|\.harness\/[\w./@-]+|src\/[\w./@-]+\.[a-zA-Z0-9]{1,10}/g;
