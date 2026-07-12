import * as vscode from "vscode";
import { AgentDefinition, loadAgents } from "./agentStore";
import { SkillDefinition, loadSkills } from "./skillStore";
import { MemoryFileRef, loadMemoryFiles } from "./memoryStore";
import { PendingProposal, loadPendingProposals } from "./pendingMemoryStore";
import { SessionInfo, loadSessions, formatRelativeTime } from "./sessionStore";
import { LiveSession } from "./liveSessionStore";
import type { LiveSessionQuery } from "./liveSessionManager";
import type { SessionStatus } from "./sessionStatus";
import type { SessionStatusQuery } from "./sessionStatusMonitor";
import type { FormKind } from "./shared/messages";

/**
 * Tree hierarchy: four top-level category nodes — Agents, Skills, Memories,
 * Sessions — each lazily loading its children when expanded.
 *
 *   Agents          -> one node per `.harness/agents/*.md` (launch/new-session
 *                      inline, click=form); collapsible when it has live sessions,
 *                      each child a worktree session (click=reveal, archive inline)
 *   Skills          -> one leaf per `.harness/skills/<name>/SKILL.md` (click=form)
 *   Memories        -> personal `memories/*.md` + `team-memories/team.md` (click=form)
 *   Session History -> `~/.claude/projects/<cwd>/*.jsonl`, newest first (click=resume)
 *
 * The provider owns no filesystem writes — it only reads. Category child lists
 * are cached and dropped wholesale on {@link refresh} (fired by file watchers).
 */

type Category = "agents" | "skills" | "memories" | "sessions" | "approvals";

interface CategoryNode {
  readonly kind: "category";
  readonly category: Category;
  readonly label: string;
}
interface AgentNode {
  readonly kind: "agent";
  readonly agent: AgentDefinition;
}
interface SkillNode {
  readonly kind: "skill";
  readonly skill: SkillDefinition;
}
interface MemoryNode {
  readonly kind: "memory";
  readonly memory: MemoryFileRef;
}
interface SessionNode {
  readonly kind: "session";
  readonly session: SessionInfo;
}
interface LiveSessionNode {
  readonly kind: "liveSession";
  readonly session: LiveSession;
}
/** Collapsed group at the bottom of Agents holding all archived sessions. */
interface ArchivedGroupNode {
  readonly kind: "archivedGroup";
}
/** A staged team-memory proposal awaiting human approve/reject. */
interface PendingNode {
  readonly kind: "pending";
  readonly proposal: PendingProposal;
}

export type TreeNode =
  | CategoryNode
  | AgentNode
  | SkillNode
  | MemoryNode
  | SessionNode
  | LiveSessionNode
  | ArchivedGroupNode
  | PendingNode;

/** Payload passed to the `harnextai.openForm` command (see extension.ts). */
export interface OpenFormArg {
  readonly kind: FormKind;
  readonly filePath: string;
}

export interface TreeSources {
  readonly agentsDir: string;
  readonly skillsDir: string;
  readonly memoriesDir: string;
  readonly teamMemoryPath: string;
  /** `.harness/team-memories/.pending/` — staged team-memory proposals. */
  readonly pendingDir: string;
  readonly homeDir: string;
  readonly workspaceRoot: string;
}

function truncate(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

/**
 * Visual presentation for a live session's inferred status. `unknown` renders no
 * badge (plain git-branch icon, no text prefix) so the format-drift fallback is
 * silent. `blocked` is intentionally the loudest — a warning icon in the theme's
 * warning color — since it means a human is being waited on.
 */
interface StatusBadge {
  readonly icon: vscode.ThemeIcon;
  /** Short word prefixed to the node description, or `undefined` for none. */
  readonly label?: string;
}

function statusBadge(status: SessionStatus): StatusBadge {
  switch (status) {
    case "working":
      return {
        icon: new vscode.ThemeIcon(
          "sync~spin",
          new vscode.ThemeColor("charts.blue"),
        ),
        label: "working",
      };
    case "blocked":
      return {
        icon: new vscode.ThemeIcon(
          "warning",
          new vscode.ThemeColor("charts.yellow"),
        ),
        label: "blocked",
      };
    case "idle":
      return {
        icon: new vscode.ThemeIcon(
          "check",
          new vscode.ThemeColor("charts.green"),
        ),
        label: "idle",
      };
    case "unknown":
      return { icon: new vscode.ThemeIcon("git-branch") };
  }
}

export class AgentTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private agentsPromise: Promise<AgentDefinition[]> | undefined;
  private skillsPromise: Promise<SkillDefinition[]> | undefined;
  private memoriesPromise: Promise<MemoryFileRef[]> | undefined;
  private sessionsPromise: Promise<SessionInfo[]> | undefined;
  private pendingPromise: Promise<PendingProposal[]> | undefined;

  constructor(
    private readonly sources: TreeSources,
    private readonly liveSessions: LiveSessionQuery,
    private readonly sessionStatus: SessionStatusQuery,
  ) {}

  /** Drop all caches and repaint. Called by the file watchers / refresh command. */
  refresh(): void {
    this.agentsPromise = undefined;
    this.skillsPromise = undefined;
    this.memoriesPromise = undefined;
    this.sessionsPromise = undefined;
    this.pendingPromise = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "category":
        return this.categoryItem(node);
      case "agent":
        return this.agentItem(node);
      case "skill":
        return this.skillItem(node);
      case "memory":
        return this.memoryItem(node);
      case "session":
        return this.sessionItem(node);
      case "liveSession":
        return this.liveSessionItem(node);
      case "archivedGroup":
        return this.archivedGroupItem();
      case "pending":
        return this.pendingItem(node);
    }
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    if (!node) {
      const roots: TreeNode[] = [
        { kind: "category", category: "agents", label: "Agents" },
        { kind: "category", category: "skills", label: "Skills" },
        { kind: "category", category: "memories", label: "Memories" },
        { kind: "category", category: "sessions", label: "Session History" },
      ];
      // Pending Approvals surfaces only when proposals are actually staged, so
      // the category is invisible in the common (empty) case.
      if ((await this.getPending()).length > 0) {
        roots.push({
          kind: "category",
          category: "approvals",
          label: "Pending Approvals",
        });
      }
      return roots;
    }

    if (node.kind === "agent") {
      return this.liveSessions
        .getForAgent(node.agent.name)
        .map(
          (session) =>
            ({ kind: "liveSession", session }) satisfies LiveSessionNode,
        );
    }

    if (node.kind === "archivedGroup") {
      return this.liveSessions
        .getArchived()
        .map(
          (session) =>
            ({ kind: "liveSession", session }) satisfies LiveSessionNode,
        );
    }

    if (node.kind === "category") {
      switch (node.category) {
        case "agents": {
          const agentNodes: TreeNode[] = (await this.getAgents()).map(
            (agent) => ({ kind: "agent", agent }),
          );
          // A single flat "Archived" group at the bottom of Agents keeps the
          // per-agent nodes uncluttered while still surfacing kept branches.
          if (this.liveSessions.hasArchived()) {
            agentNodes.push({ kind: "archivedGroup" });
          }
          return agentNodes;
        }
        case "skills":
          return (await this.getSkills()).map((skill) => ({
            kind: "skill",
            skill,
          }));
        case "memories":
          return (await this.getMemories()).map((memory) => ({
            kind: "memory",
            memory,
          }));
        case "sessions":
          return (await this.getSessions()).map((session) => ({
            kind: "session",
            session,
          }));
        case "approvals":
          return (await this.getPending()).map((proposal) => ({
            kind: "pending",
            proposal,
          }));
      }
    }

    return [];
  }

  // -- item builders -------------------------------------------------------

  private categoryItem(node: CategoryNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.contextValue = `category:${node.category}`;
    const icons: Record<Category, string> = {
      agents: "organization",
      skills: "lightbulb",
      memories: "book",
      sessions: "history",
      approvals: "inbox",
    };
    item.iconPath = new vscode.ThemeIcon(icons[node.category]);
    return item;
  }

  private agentItem(node: AgentNode): vscode.TreeItem {
    const { agent } = node;
    const live = this.liveSessions.getForAgent(agent.name);
    const archived = this.liveSessions
      .getArchived()
      .filter((s) => s.agentName === agent.name);
    const hasSessions = live.length > 0;
    const item = new vscode.TreeItem(
      agent.name,
      hasSessions
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.description = agent.model;
    // Session stats from the data the tree already holds — no extra scanning.
    // `getForAgent`/`getArchived` are already newest-first, so the most recent
    // createdAt across both lists is the "last active" moment.
    const mostRecent = [...live, ...archived]
      .map((s) => s.createdAt)
      .reduce((max, t) => (t > max ? t : max), 0);
    const stats =
      `- Live sessions: ${live.length}\n` +
      `- Archived sessions: ${archived.length}\n` +
      `- Last active: ${mostRecent > 0 ? formatRelativeTime(mostRecent) : "never"}`;
    item.tooltip = new vscode.MarkdownString(
      `**${agent.name}**${agent.model ? ` · \`${agent.model}\`` : ""}\n\n` +
        `${agent.description}\n\n${stats}`,
    );
    item.iconPath = new vscode.ThemeIcon("robot");
    item.contextValue = "agent";
    item.resourceUri = vscode.Uri.file(agent.filePath);
    item.command = {
      command: "harnextai.openForm",
      title: "Edit Agent",
      arguments: [
        { kind: "agent", filePath: agent.filePath } satisfies OpenFormArg,
      ],
    };
    return item;
  }

  private skillItem(node: SkillNode): vscode.TreeItem {
    const { skill } = node;
    const item = new vscode.TreeItem(
      skill.name,
      vscode.TreeItemCollapsibleState.None,
    );
    if (skill.disableModelInvocation) {
      item.description = "manual";
    }
    item.tooltip = new vscode.MarkdownString(
      `**${skill.name}**\n\n${skill.description}`,
    );
    item.iconPath = new vscode.ThemeIcon("lightbulb");
    item.contextValue = "skill";
    item.resourceUri = vscode.Uri.file(skill.filePath);
    item.command = {
      command: "harnextai.openForm",
      title: "Edit Skill",
      arguments: [
        { kind: "skill", filePath: skill.filePath } satisfies OpenFormArg,
      ],
    };
    return item;
  }

  private memoryItem(node: MemoryNode): vscode.TreeItem {
    const { memory } = node;
    const item = new vscode.TreeItem(
      memory.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon("note");
    item.contextValue = "memory";
    item.resourceUri = vscode.Uri.file(memory.filePath);
    item.command = {
      command: "harnextai.openForm",
      title: "Edit Memory",
      arguments: [
        { kind: "memory", filePath: memory.filePath } satisfies OpenFormArg,
      ],
    };
    return item;
  }

  private sessionItem(node: SessionNode): vscode.TreeItem {
    const { session } = node;
    const label = session.firstPrompt
      ? truncate(session.firstPrompt)
      : session.sessionId.slice(0, 8);
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = formatRelativeTime(session.mtimeMs);
    item.tooltip = new vscode.MarkdownString(
      `**Session** \`${session.sessionId}\`\n\n${session.firstPrompt || "_no prompt text_"}`,
    );
    item.iconPath = new vscode.ThemeIcon("comment-discussion");
    item.contextValue = "session";
    item.command = {
      command: "harnextai.resumeSession",
      title: "Resume Session",
      arguments: [session.sessionId],
    };
    return item;
  }

  private liveSessionItem(node: LiveSessionNode): vscode.TreeItem {
    const { session } = node;
    if (session.archived) {
      return this.archivedSessionItem(session);
    }
    const status = this.sessionStatus.getStatus(session.slug);
    const badge = statusBadge(status);
    const item = new vscode.TreeItem(
      session.slug,
      vscode.TreeItemCollapsibleState.None,
    );
    const prefix = badge.label ? `${badge.label} · ` : "";
    item.description = `${prefix}${session.branch} · ${formatRelativeTime(session.createdAt)}`;
    item.tooltip = new vscode.MarkdownString(
      `**Live session** \`${session.slug}\`\n\n` +
        `- Status: \`${status}\`\n` +
        `- Agent: \`${session.agentName}\`\n` +
        `- Branch: \`${session.branch}\`\n` +
        `- Worktree: \`${session.worktreePath}\``,
    );
    item.iconPath = badge.icon;
    item.contextValue = "liveSession";
    item.command = {
      command: "harnextai.revealSession",
      title: "Open Session",
      arguments: [node],
    };
    return item;
  }

  /**
   * An archived session: worktree gone, branch kept. Shows slug + branch so the
   * user can locate the branch. Distinct `viewItem` ("archivedSession") so only
   * the Delete action targets it; no reveal/open command since there is no
   * worktree to return to.
   */
  private archivedSessionItem(session: LiveSession): vscode.TreeItem {
    const item = new vscode.TreeItem(
      session.slug,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = `${session.branch} · archived ${formatRelativeTime(session.createdAt)}`;
    item.tooltip = new vscode.MarkdownString(
      `**Archived session** \`${session.slug}\`\n\n` +
        `- Agent: \`${session.agentName}\`\n` +
        `- Branch (kept): \`${session.branch}\`\n\n` +
        `The worktree was removed. Check out \`${session.branch}\` to resume the work.`,
    );
    item.iconPath = new vscode.ThemeIcon("archive");
    item.contextValue = "archivedSession";
    return item;
  }

  private pendingItem(node: PendingNode): vscode.TreeItem {
    const { proposal } = node;
    const item = new vscode.TreeItem(
      proposal.slug,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = truncate(proposal.preview || "(empty proposal)");
    item.tooltip = new vscode.MarkdownString(
      `**Pending team-memory proposal** \`${proposal.slug}\`\n\n` +
        `${proposal.entry || "_no durable content_"}`,
    );
    item.iconPath = new vscode.ThemeIcon("git-pull-request");
    item.contextValue = "pendingProposal";
    item.resourceUri = vscode.Uri.file(proposal.filePath);
    return item;
  }

  private archivedGroupItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      "Archived",
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.iconPath = new vscode.ThemeIcon("archive");
    item.contextValue = "archivedGroup";
    return item;
  }

  // -- cached loaders ------------------------------------------------------

  private getAgents(): Promise<AgentDefinition[]> {
    return (this.agentsPromise ??= loadAgents(this.sources.agentsDir));
  }
  private getSkills(): Promise<SkillDefinition[]> {
    return (this.skillsPromise ??= loadSkills(this.sources.skillsDir));
  }
  private getMemories(): Promise<MemoryFileRef[]> {
    return (this.memoriesPromise ??= loadMemoryFiles(
      this.sources.memoriesDir,
      this.sources.teamMemoryPath,
    ));
  }
  private getSessions(): Promise<SessionInfo[]> {
    return (this.sessionsPromise ??= loadSessions(
      this.sources.homeDir,
      this.sources.workspaceRoot,
    ));
  }
  private getPending(): Promise<PendingProposal[]> {
    return (this.pendingPromise ??= loadPendingProposals(
      this.sources.pendingDir,
    ));
  }
}
