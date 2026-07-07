---
name: webview-ui
description: Rules for the agent-CRM webview panel. Use when building or editing webview HTML/CSS/TS, CSP, postMessage flows, or webview state.
---

# Webview UI — the agent CRM panel

The CRM surface (agent list, agent detail, skill editor) is a webview. These
rules are non-negotiable; the Reviewer checks every one.

## Security

- Strict CSP: `default-src 'none'`; scripts only via `nonce-…`; styles/images
  via `webview.cspSource`. Never `unsafe-inline` for scripts, never remote content.
- Load local resources only through `webview.asWebviewUri` with
  `localResourceRoots` pinned to the extension's media dir.
- Validate every `postMessage` payload on **both** sides against a shared
  discriminated-union message type in `src/shared/messages.ts` — the single
  source of truth for the protocol. Unknown message types are logged and dropped.

## State & lifecycle

- `retainContextWhenHidden: false`; restore UI from `getState`/`setState` and a
  full state push from the extension on `onDidReceiveMessage('ready')`.
- The extension side owns all data (agent files on disk); the webview renders
  and requests — it never touches the filesystem model directly.

## Look & feel

- Use VS Code CSS variables (`--vscode-*`) for all colors/fonts so themes work;
  no hardcoded palette.
- Keep the webview bundle dependency-free or near it; ask before adding a UI
  framework (ground rule 3).
