# Ground rules

Hard limits for every harness agent. Never crossed without the user's explicit,
in-session approval.

1. **Never push to `main`** (or `master`). Work on branches; the user merges.
2. **Never publish or release** — no `vsce publish`, no Marketplace, no npm publish, no tags.
3. **Never add a dependency without asking.** Propose the package and why; wait for a yes.
4. **Never delete files outside the current task's scope.**
5. **Never write to `.harness/team-memories/team.md` directly.** Team knowledge goes
   through `.harness/team-memories/.pending/` proposals per the memory protocol.
