---
name: vscode-extension-dev
description: Architecture rules for this VS Code extension. Use when creating or editing extension source — activation, package.json contributes, commands, tree views, bundling, or extension tests.
---

# VS Code extension development — intelligents

House rules for the extension host side. Webview rules live in the `webview-ui`
skill; Claude Code/Copilot integration in `agent-runtime-interop`.

## Structure

- `src/extension.ts` exports `activate`/`deactivate` only — wiring, no logic.
- One module per feature under `src/`: agent CRM tree view, agent store,
  terminal/session management, copilot bridge. Domain logic must not import
  `vscode` — keep it testable without the extension host.
- Every `contributes` entry in `package.json` (commands, views, menus,
  configuration) has exactly one registration in code, and vice versa.

## Activation & lifecycle

- Narrow activation events (`onView:`, `onCommand:`) — never `*`.
- `activate` does no I/O beyond cheap sync setup; defer loading agent data until
  the view is opened.
- Everything disposable goes into `context.subscriptions` at creation.
- Persist UI state in `workspaceState`/`globalState`; user settings via
  `contributes.configuration` — not ad-hoc JSON files.

## Build & test

- Bundle with esbuild to a single `dist/extension.js`; `vscode` is the only external.
- Tests: unit-test domain modules with plain vitest/mocha; use
  `@vscode/test-electron` only for host-dependent behavior.
- Launch for manual checks: F5 (Extension Development Host).

A change is complete only when `package.json` contributes, the registration
code, and tests agree with each other.
