<!-- proposal: append to team-memories/team.md -->

- Unit tests use Node's built-in `node:test` + `node:assert/strict` and import `.ts` sources directly; there is no `npm test` script. Run them with `npx tsx --test src/<file>.test.ts` (Node 24 + tsx are available). Domain modules stay `vscode`-free so they run under plain tsx; the `transcript.test.ts` "real transcripts" case reads local `~/.claude` fixtures and can fail on machines without them (environment-dependent, not a regression).

Justification: the missing `npm test` script and the exact tsx invocation are not discoverable from package.json and repeatedly trip up test runs; the transcript-test caveat prevents false-alarm regressions.
