# Workflow tool catalog

Map each external-services answer from the interview to a suggestion below.
Present: what it buys, how to install, and let the user accept or decline —
never install unasked. For Claude Code, accepted MCP servers go in the
project's `.mcp.json`; for Cursor, in `.cursor/mcp.json`.

Verify currency before suggesting: server names and packages rot. When
unsure, search for the vendor's current official MCP server rather than
trusting this table blindly.

| Interview answer           | Suggest                                  | Kind   | Why                                                       |
| -------------------------- | ---------------------------------------- | ------ | --------------------------------------------------------- |
| GitHub                     | `gh` CLI                                 | CLI    | PRs, issues, checks from any agent; no MCP needed         |
| GitLab                     | `glab` CLI                               | CLI    | Same, for GitLab                                          |
| Jira / Confluence          | Atlassian MCP (Rovo)                     | MCP    | Ticket reads/writes from the Researcher/Developer         |
| Linear                     | Linear MCP                               | MCP    | Ticket-driven workflow                                    |
| Postgres/MySQL             | official DB MCP server (read-only creds) | MCP    | Researcher can inspect schema/data safely                 |
| Figma handoffs             | Figma MCP                                | MCP    | Developer reads real design values instead of screenshots |
| Sentry / error tracking    | Sentry MCP or `sentry-cli`               | either | Bug investigation with real stack traces                  |
| Playwright/browser testing | Playwright MCP                           | MCP    | Reviewer/Developer can drive the app                      |
| Vercel / Netlify / Fly     | vendor CLI                               | CLI    | Deploy status and logs                                    |
| CI (GitHub Actions)        | covered by `gh run`                      | CLI    | Watch runs, fetch failing logs                            |

Guidance:

- Prefer a CLI over an MCP server when both exist — CLIs work in every
  coding tool, MCP configs are per-tool.
- Databases: insist on read-only credentials in the suggestion itself.
- Cap the accepted list — every MCP server adds always-loaded context in the
  host tool; suggest only what the interview showed the workflow actually
  touches.
