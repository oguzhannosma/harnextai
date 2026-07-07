# Research: What developers want from agentic engineering tools (2026)

Date: 2026-07-08
Author: researcher agent
Feeds: product-direction decision for the `intelligents` VS Code extension
(agent-CRM style manager for Claude Code / Copilot worktrees and sessions),
branch `researcher/what-people-want`.

Status: web search evidence only (no primary-source paywalled reports fetched
in full; Anthropic's 2026 Agentic Coding Trends Report PDF was not opened
directly, only summarized via secondary coverage — flagged unverified at
first-hand level). Builds on and cross-references
`docs/research/2026-07-07-inspirations-and-vscode-feasibility.md` (Conductor /
damon-ade / Herdr audit), which already covers the closest direct competitors
in depth.

---

## 1. Top desired features

- **Context engineering / context management as the core skill.** Anthropic's
  2026 Agentic Coding Trends Report (via secondary coverage) reports teams
  with well-maintained context files for their agents see 40% fewer errors and
  complete tasks 55% faster. HN discourse converges on the same point: agents
  that "waste half the session rediscovering structure" are the top complaint;
  compaction (compressing prior context into denser working state) can cut
  input tokens ~86% with no measurable score drop.
- **Cost / token visibility.** Repeatedly surfaced as a governance gap —
  token spend is invisible to the people managing budgets. Concrete evidence:
  Uber rolled Claude Code out to ~5,000 engineers (Dec 2025), usage nearly
  doubled by Feb 2026, and the company burned its entire 2026 AI budget by
  April; Microsoft canceled many internal Claude Code licenses over runaway
  token bills. Re-sent context (full conversation history re-transmitted every
  turn) is cited as ~62% of the bill — the single biggest optimization target.
- **Multi-agent / parallel session orchestration with isolation.** The
  dominant pattern in 2026 is git-worktree-per-task so parallel agents never
  touch the same files. Tools built around exactly this: Conductor (Mac app,
  Claude Code/Codex/Cursor, dashboard + diff + PR + "archive worktree" flow),
  Claude Squad (~7.9k GitHub stars, tmux-based terminal wrapper, per-task
  isolated git workspace), Nimbalyst (successor to "Crystal", first GUI for
  parallel Claude Code sessions), Vibe Kanban (web dashboard, kanban-style task
  tracking across agents — company behind it shut down cloud/paid product
  April 2026 but the OSS project continues under Apache-2.0), Superset ("10+
  parallel coding agents on your machine").
- **Review/diff UX as a first-class flow, not an afterthought.** Common
  pattern: review the agent's diff like a human PR, run it locally, gate on
  CI, only then merge — with no agent commits skipping the checks human
  commits go through. Reviewing has overtaken writing as the single largest
  AI-assisted time sink as of Q1 2026 (reversal from earlier surveys), driven
  by async agents producing review-ready diffs while the developer works
  elsewhere.
- **Human-in-the-loop checkpoints without losing autonomy.** Developers want
  to delegate tasks that are easily verifiable or low-stakes, but fully
  delegate only an estimated 0–20% of tasks even though AI touches ~60% of
  their work (the "delegation gap"). Shared task lists with dependency
  tracking (so, e.g., a testing agent waits for a backend agent to finish) are
  emerging as the coordination primitive for agent teams.
- **Persistent identity / memory across sessions**, not throwaway chats —
  this is damon-ade's core thesis (see the companion inspirations doc) and
  aligns with the broader "context rot" discussion: without deliberate memory
  management, longer context windows degrade rather than help.
- **Native IDE integration is arriving fast and getting deeper.** VS Code
  1.120 (~May 2026) shipped a built-in "Agents window" — a dedicated window
  with a session sidebar (grouped by workspace or timeframe, pin/rename/drag-
  drop, custom groups), a Changes panel for reviewing file diffs, and support
  for side-by-side comparison of multiple sessions. This is direct,
  Microsoft-shipped competition for anything that is "just a session list."

## 2. Top pain points / complaints

- **"Almost right, but not quite" output** is the single most-cited
  frustration (66% of developers per one 2026 survey), and trust in AI output
  accuracy has fallen (29% trust it, down from 40% in 2024) even as adoption
  rises — implies review/verification tooling matters more than raw
  generation quality.
- **Runaway cost / budget blowouts** at organizational scale (Uber, Microsoft
  examples above) — token spend isn't just an individual annoyance, it's
  becoming a procurement/finance-level blocker to continued rollout.
- **Cross-file / cross-module coherence breaks down.** Copilot specifically
  is called out as strong within a single file but losing the thread once a
  change must stay coherent across ~5 files in a module.
- **Tool/product churn and rug-pulls.** Windsurf's Cascade (the local agent
  that differentiated it) was EOL'd July 1 2026 and replaced by "Devin Local"
  after Cognition acquired the team; original founders left to Google
  DeepMind mid-2025. Vibe Kanban's company shut down its paid/cloud product
  April 2026. Cursor moved from a flat 500-request plan to a credit system in
  mid-2025, which was received badly (one Reddit callout post got 3,200
  upvotes) since existing subscribers effectively lost ~55% of their quota.
  Implication: developers/teams are wary of vendor lock-in and pricing model
  changes in this space — an argument for local-first, BYO-subscription
  tooling (which is also damon-ade's and Conductor's model).
- **UX friction in existing multi-instance tools.** Cursor: changing model in
  one instance changes it globally across all open instances — annoying when
  running different models for different parallel tasks. Cursor also has
  indexing lag/freezes reported on 500K+ line codebases.
- **Context pollution / "context rot"** — the more a long session
  accumulates, the more of that history is stale-but-still-resent, degrading
  both quality and cost. This is treated as a systemic, not tool-specific,
  problem across the ecosystem.
- **Rate limits hit by heavy users** — e.g. Cursor Pro's 1 request/min, 30/hr
  ceiling pushes power users to a 3x-priced tier.

## 3. Emerging trends (2025–2026 discourse)

- **From "pair programmer" to "autonomous team member."** Long-running agent
  sessions (hours, not minutes) are becoming routine; one cited case completed
  changes across a 12.5M-line codebase in a single 7-hour autonomous run.
- **Engineer role shift toward orchestration.** The Anthropic report frames
  the core engineering activity moving from writing code to coordinating
  agents — architecture, agent-task decomposition, and quality evaluation
  become the primary skills, not typing.
- **"Agent teams" with role specialization** (Planner → Architect →
  Implementer → Tester → Reviewer) coordinated via a shared, dependency-aware
  task list is the pattern multiple sources converge on for multi-agent
  orchestration, rather than N independent agents with no shared state.
- **A dedicated tooling category has formed around "supervise many parallel
  agents"** — this is no longer a niche DIY tmux trick; it's now a
  named/competed-in space (Conductor, Claude Squad, Nimbalyst, Vibe Kanban,
  Superset, Paneflow are all named as of mid-2026 "best of" roundups).
  `intelligents` is entering an already-populated category, not creating one.
- **Multi-tool-per-developer is now the norm**, not the exception: 65% of
  engineers reportedly use at least two AI coding tools daily (e.g. an editor
  like Cursor for inline/Tab plus an agent like Claude Code for full features)
  — implies an "agent CRM" needs to be runtime-agnostic (Claude Code, Codex,
  etc.) rather than Claude-Code-only to match how people actually work, which
  is exactly the direction Conductor and Claude Squad already went.
  **However** — this repo/extension is explicitly scoped to Claude Code +
  Copilot interop per its skills (`agent-runtime-interop`), so this is a
  scope note, not necessarily a directive to expand runtime support now.
- **Security discourse emerging**: "agentjacking" — prompt-injection-style
  attacks that trick coding agents into running malicious commands — is
  showing up as a named threat category in 2026, relevant to any tool that
  automates agent execution/review approval.
- **Agent scheduling as "next infrastructure problem"**: framing agents as
  long-running, stateful, async "digital workers" rather than
  request/response chat, which pushes toward needing durable task queues and
  status tracking — closer to CRM/kanban modeling than chat UI.

## 4. Direct implications for the "agent CRM" VS Code extension

1. **The core wedge (worktree-per-task + tree/dashboard view + diff review) is
   validated demand**, not a guess — it's the exact shape of Conductor, Claude
   Squad, Nimbalyst, and Vibe Kanban, all of which have real usage and
   positive testimonials. But it's a crowded lane; VS Code itself now ships a
   native competing session sidebar (1.120 Agents window). Differentiation
   likely has to come from CRM-depth (task/status tracking, forms, cross-
   session history) that the native VS Code UI and pure terminal wrappers
   (Claude Squad) don't attempt, and from Copilot interop specifically.
2. **Add cost/token visibility per session/agent to the CRM's status badges.**
   This is a top, org-validated pain point (Uber/Microsoft budget blowouts)
   and nothing in the reviewed competitor set (Conductor, Claude Squad,
   damon-ade) appears to foreground it — a plausible differentiator.
3. **Treat worktree archive/cleanup as first-class**, matching Conductor —
   already flagged in the companion inspirations doc, reinforced here as a
   named pain point (raw `git worktree` tooling leaves cleanup manual).
4. **Human-in-the-loop review needs to be fast, not just present** — given
   "reviewing overtook writing" as the top time sink, the diff/review flow's
   speed and clarity matters as much as the orchestration/tree view itself.
   Reuse VS Code's native SCM diff (per the inspirations doc) rather than
   building a custom differ, to keep review friction low.
5. **Shared task list / dependency tracking between agents** is where
   multi-agent orchestration discourse is heading (Planner→Implementer→
   Tester chains) — worth considering as a v2 CRM feature (agents blocking on
   each other's task completion) rather than only tracking agents as
   independent rows.
6. **Vendor-churn wariness favors a local-first, BYO-subscription, runtime-
   agnostic-if-possible design** — consistent with this project's existing
   direction (Conductor/damon-ade-inspired, uses `~/.claude` directly rather
   than a hosted backend).
7. **Security note**: since the extension will presumably let a user review-
   and-approve agent actions, the "agentjacking" trend is a reason to keep
   human approval gates meaningful (not just a rubber-stamp click) in any
   auto-run/review workflow the CRM builds.

## Sources

- Cursor/Copilot/Windsurf complaints: [Kanerika comparison](https://medium.com/@kanerika/github-copilot-vs-claude-code-vs-cursor-vs-windsurf-2026-c54f8a5cc051), [Tech Insider Windsurf vs Cursor](https://tech-insider.org/windsurf-vs-cursor-2026/)
- Trust/accuracy stats, review-as-top-time-sink, multi-tool-per-dev stats: search-aggregated from Uvik, Faros AI, digitalapplied.com developer survey coverage (2026)
- Anthropic 2026 Agentic Coding Trends Report (secondary coverage): [resources.anthropic.com PDF](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf), [Pathmode summary](https://pathmode.io/blog/orchestration-era-needs-intent), [ClaudeAINews summary](https://www.claudeainews.com/news/anthropic-2026-agentic-coding-report)
- Token cost/budget blowouts (Uber, Microsoft): [Vantage — Hidden Cost Driver in Agentic Coding](https://www.vantage.sh/blog/agentic-coding-costs), [LeanOps — AI Agents Burn 50x More Tokens](https://leanopstech.com/blog/agentic-ai-cost-runaway-token-budget-2026/)
- Context rot / compaction / HN discourse: [HN: Agentic coding is burning me out](https://news.ycombinator.com/item?id=47962775), [HN: Agentic Coding Is a Trap](https://news.ycombinator.com/item?id=48002442), [Developers Digest — What HN Gets Right](https://www.developersdigest.tech/blog/what-hacker-news-gets-right-about-ai-coding-agents-2026)
- Worktree/parallel-agent tooling landscape: [Conductor](https://www.conductor.build/), [Conductor HN launch](https://news.ycombinator.com/item?id=44594584), [Claude Squad repo](https://github.com/smtg-ai/claude-squad), [Nimbalyst — best agent management tools 2026](https://nimbalyst.com/blog/best-agent-management-tools-2026/), [Vibe Kanban repo](https://github.com/BloopAI/vibe-kanban), [Superset](https://superset.sh/)
- VS Code native Agents window: [VS Code docs — Agents window](https://code.visualstudio.com/docs/copilot/agents/agents-window), [Visual Studio Magazine hands-on](https://visualstudiomagazine.com/articles/2026/05/13/hands-on-with-the-new-agents-window-in-vs-code-1,-d-,120.aspx)
- Multi-agent orchestration patterns / agent scheduling: [MindStudio — Claude Code Agent Teams](https://www.mindstudio.ai/blog/claude-code-agent-teams-parallel-workflows), [dev.to — Why Agent Scheduling Is Your Next Infrastructure Problem](https://dev.to/paultwist/why-agent-scheduling-is-your-next-infrastructure-problem-3gh2)
- Agentjacking: [Develeap — Agentjacking Attack](https://www.develeap.com/news/agentjacking-attack-tricks-ai-coding-agents-into-running-mal-df1ddb55/)
