import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import {
  AgentTreeProvider,
  OpenFormArg,
  TreeNode,
  TreeSources,
} from "./agentTree";
import { FormPanel } from "./formPanel";
import { TranscriptPanel } from "./transcriptPanel";
import { MemoryPanelView } from "./memoryPanelView";
import { StatusBarController } from "./statusBar";
import { LiveSessionManager } from "./liveSessionManager";
import { SessionStatusMonitor } from "./sessionStatusMonitor";
import { loadAgents, createAgent, duplicateAgent } from "./agentStore";
import { loadSkills, createSkill } from "./skillStore";
import { deleteHistorySession } from "./sessionStore";
import { validateSlugName } from "./naming";
import { approveProposal, rejectProposal } from "./pendingMemoryStore";

const VIEW_ID = "intelligents.agentsView";

// Watched globs — each mirrors a tree category source. All wired the same
// defensive way (create/change/delete -> refresh), matching the original agent
// watcher pattern.
const WATCH_GLOBS = [
  ".harness/agents/*.md",
  ".harness/skills/**/SKILL.md",
  ".harness/memories/*.md",
  ".harness/team-memories/team.md",
  ".harness/team-memories/.pending/*.md",
];

/**
 * Extension entry point — wiring only, no domain logic (per the
 * `vscode-extension-dev` skill). Registers the tree view, file watchers that
 * refresh it, the editor webview panel, and the launch/resume/refresh commands.
 * All disposables go to `context.subscriptions`; no I/O beyond cheap sync setup
 * happens here — category data loads lazily when the view is expanded.
 */
export function activate(context: vscode.ExtensionContext): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return; // Nothing to source from without an open folder.
  }
  const root = workspaceFolder.uri.fsPath;

  const sources: TreeSources = {
    agentsDir: path.join(root, ".harness", "agents"),
    skillsDir: path.join(root, ".harness", "skills"),
    memoriesDir: path.join(root, ".harness", "memories"),
    teamMemoryPath: path.join(root, ".harness", "team-memories", "team.md"),
    pendingDir: path.join(root, ".harness", "team-memories", ".pending"),
    homeDir: os.homedir(),
    workspaceRoot: root,
  };

  // Manager and provider are mutually referential: the manager repaints the
  // tree on state changes, the provider reads live sessions from the manager.
  // `provider` is assigned before any refresh can fire (reconcile runs async
  // below, user actions come later), so the closure is safe.
  // The monitor (transcript-status badges) and manager are mutually referential
  // too: the manager tells the monitor which sessions to watch; the monitor's
  // blocked-notification button reveals a session's terminal via the manager.
  // Both close over each other and over `provider`, all assigned before any
  // callback can fire (watchers/reconcile run async, user actions come later).
  // The status bar summarizes live sessions from the very same events that
  // repaint the tree — `onSessionsChanged` (records changed) and the monitor's
  // debounced reclassification (a badge flipped) both also refresh it. Declared
  // here and assigned below before any of those callbacks can fire.
  let provider: AgentTreeProvider;
  let statusMonitor: SessionStatusMonitor;
  let statusBar: StatusBarController;
  const liveSessions = new LiveSessionManager(
    root,
    context,
    () => provider.refresh(),
    (sessions) => {
      statusMonitor.syncSessions(sessions);
      statusBar.refresh();
    },
  );
  statusMonitor = new SessionStatusMonitor(
    os.homedir(),
    () => {
      provider.refresh();
      statusBar.refresh();
    },
    (session) => liveSessions.reveal(session),
  );
  context.subscriptions.push({ dispose: () => statusMonitor.dispose() });
  statusBar = new StatusBarController(liveSessions, statusMonitor);
  context.subscriptions.push({ dispose: () => statusBar.dispose() });
  provider = new AgentTreeProvider(sources, liveSessions, statusMonitor);
  const view = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
  });
  context.subscriptions.push(view);

  // Watch transcripts for any sessions restored from a previous window.
  statusMonitor.syncSessions(liveSessions.allSessions());
  // Seed the status bar from any restored sessions (hidden if none).
  statusBar.refresh();

  // Drop records whose worktree was removed outside the extension.
  void liveSessions.reconcile();

  const mediaUri = vscode.Uri.joinPath(context.extensionUri, "media");
  const formPanel = new FormPanel(mediaUri, () => provider.refresh());
  context.subscriptions.push({ dispose: () => formPanel.dispose() });

  // Read-only visibility panels: a reusable transcript viewer and a single
  // live-memory panel (its own memory-file watchers, created when it opens).
  const transcriptPanel = new TranscriptPanel(mediaUri);
  context.subscriptions.push({ dispose: () => transcriptPanel.dispose() });
  const memoryPanel = new MemoryPanelView(
    mediaUri,
    workspaceFolder,
    sources.memoriesDir,
    sources.teamMemoryPath,
  );
  context.subscriptions.push({ dispose: () => memoryPanel.dispose() });

  // One watcher per source glob; every event just drops caches and repaints.
  for (const glob of WATCH_GLOBS) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, glob),
    );
    watcher.onDidCreate(
      () => provider.refresh(),
      undefined,
      context.subscriptions,
    );
    watcher.onDidChange(
      () => provider.refresh(),
      undefined,
      context.subscriptions,
    );
    watcher.onDidDelete(
      () => provider.refresh(),
      undefined,
      context.subscriptions,
    );
    context.subscriptions.push(watcher);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("intelligents.refresh", () =>
      provider.refresh(),
    ),
    vscode.commands.registerCommand("intelligents.newAgent", async () => {
      const existing = (await loadAgents(sources.agentsDir)).map((a) => a.name);
      const name = await promptForName("New Agent", "agent", existing);
      if (!name) {
        return;
      }
      let filePath: string;
      try {
        filePath = await createAgent(sources.agentsDir, name);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Failed to create agent: ${errText(err)}`,
        );
        return;
      }
      provider.refresh();
      void formPanel.open({ kind: "agent", filePath });
      suggestHarnessDoctor();
    }),
    vscode.commands.registerCommand("intelligents.newSkill", async () => {
      const existing = (await loadSkills(sources.skillsDir)).map((s) => s.name);
      const name = await promptForName("New Skill", "skill", existing);
      if (!name) {
        return;
      }
      let filePath: string;
      try {
        filePath = await createSkill(sources.skillsDir, name);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Failed to create skill: ${errText(err)}`,
        );
        return;
      }
      provider.refresh();
      void formPanel.open({ kind: "skill", filePath });
      suggestHarnessDoctor();
    }),
    vscode.commands.registerCommand(
      "intelligents.duplicateAgent",
      async (node: TreeNode) => {
        if (node?.kind !== "agent") {
          return;
        }
        const existing = (await loadAgents(sources.agentsDir)).map(
          (a) => a.name,
        );
        const name = await promptForName(
          `Duplicate Agent — ${node.agent.name}`,
          "agent",
          existing,
          `${node.agent.name}-copy`,
        );
        if (!name) {
          return;
        }
        let filePath: string;
        try {
          filePath = await duplicateAgent(
            node.agent.filePath,
            sources.agentsDir,
            name,
          );
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Failed to duplicate agent: ${errText(err)}`,
          );
          return;
        }
        provider.refresh();
        void formPanel.open({ kind: "agent", filePath });
        suggestHarnessDoctor();
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.approveProposal",
      async (node: TreeNode) => {
        if (node?.kind !== "pending") {
          return;
        }
        const { proposal } = node;
        try {
          let result = await approveProposal(
            proposal.filePath,
            sources.teamMemoryPath,
            4000,
          );
          if (result.empty) {
            void vscode.window.showWarningMessage(
              `Proposal "${proposal.slug}" has no durable content to approve.`,
            );
            return;
          }
          if (result.exceedsBudget && !result.appended) {
            const proceed = await vscode.window.showWarningMessage(
              `Approving "${proposal.slug}" pushes team memory to ${result.used}/${result.budget} chars, over budget. Append anyway?`,
              { modal: true },
              "Append Anyway",
            );
            if (proceed !== "Append Anyway") {
              return;
            }
            result = await approveProposal(
              proposal.filePath,
              sources.teamMemoryPath,
              4000,
              true,
            );
          }
          if (result.appended) {
            void vscode.window.showInformationMessage(
              `Approved "${proposal.slug}" — team memory now ${result.used}/${result.budget} chars.` +
                (result.exceedsBudget
                  ? " (over budget — consider consolidating)"
                  : ""),
            );
          }
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Failed to approve proposal: ${errText(err)}`,
          );
          return;
        }
        provider.refresh();
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.rejectProposal",
      async (node: TreeNode) => {
        if (node?.kind !== "pending") {
          return;
        }
        const { proposal } = node;
        const confirm = await vscode.window.showWarningMessage(
          `Reject and delete proposal "${proposal.slug}"? This cannot be undone.`,
          { modal: true },
          "Reject",
        );
        if (confirm !== "Reject") {
          return;
        }
        try {
          await rejectProposal(proposal.filePath);
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Failed to reject proposal: ${errText(err)}`,
          );
          return;
        }
        provider.refresh();
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.openForm",
      (arg: OpenFormArg) => {
        if (arg && typeof arg.filePath === "string" && arg.kind) {
          void formPanel.open(arg);
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.launchAgent",
      (node: TreeNode) => {
        if (node?.kind === "agent") {
          launchInTerminal(
            `Agent: ${node.agent.name}`,
            root,
            `claude --agent ${node.agent.name}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.resumeSession",
      (sessionId: string) => {
        if (typeof sessionId === "string" && sessionId) {
          launchInTerminal(
            `Session: ${sessionId.slice(0, 8)}`,
            root,
            `claude --resume ${sessionId}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.newSession",
      async (node?: TreeNode) => {
        const agentName =
          node?.kind === "agent"
            ? node.agent.name
            : await pickAgentName(sources.agentsDir);
        if (agentName) {
          await liveSessions.newSession(agentName);
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.revealSession",
      (node: TreeNode) => {
        if (node?.kind === "liveSession") {
          liveSessions.reveal(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.archiveSession",
      async (node: TreeNode) => {
        if (node?.kind === "liveSession" && !node.session.archived) {
          await liveSessions.archive(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.deleteSession",
      async (node: TreeNode) => {
        if (node?.kind === "liveSession") {
          await liveSessions.delete(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.sendMessage",
      async (node: TreeNode) => {
        if (node?.kind === "liveSession" && !node.session.archived) {
          await liveSessions.sendMessage(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.reviewSession",
      async (node: TreeNode) => {
        if (node?.kind === "liveSession" && !node.session.archived) {
          await liveSessions.reviewSession(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.mergeSession",
      async (node: TreeNode) => {
        if (node?.kind === "liveSession" && !node.session.archived) {
          await liveSessions.mergeSession(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.openWorktree",
      (node: TreeNode) => {
        if (node?.kind === "liveSession" && !node.session.archived) {
          void vscode.commands.executeCommand(
            "vscode.openFolder",
            vscode.Uri.file(node.session.worktreePath),
            { forceNewWindow: true },
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.deleteHistorySession",
      async (node: TreeNode) => {
        if (node?.kind !== "session") {
          return;
        }
        const { session } = node;
        const confirm = await vscode.window.showWarningMessage(
          `Delete this session transcript? This removes it permanently — it cannot be resumed afterward.`,
          { modal: true },
          "Delete",
        );
        if (confirm !== "Delete") {
          return;
        }
        try {
          await deleteHistorySession(
            sources.homeDir,
            session.filePath,
            session.sessionId,
          );
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Failed to delete session transcript: ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
        provider.refresh();
      },
    ),
    vscode.commands.registerCommand(
      "intelligents.viewTranscript",
      (node: TreeNode) => {
        if (node?.kind !== "session") {
          return;
        }
        const { session } = node;
        // Same label the tree shows: first-prompt (truncated) or short id.
        const title = session.firstPrompt
          ? truncateTitle(session.firstPrompt)
          : session.sessionId.slice(0, 8);
        void transcriptPanel.open({ filePath: session.filePath, title });
      },
    ),
    vscode.commands.registerCommand("intelligents.showMemoryPanel", () => {
      void memoryPanel.open();
    }),
  );
}

/** One-line, length-capped title for the transcript panel (mirrors the tree). */
function truncateTitle(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

/** Command-palette entry point: choose which agent to start a session for. */
async function pickAgentName(agentsDir: string): Promise<string | undefined> {
  const agents = await loadAgents(agentsDir);
  if (agents.length === 0) {
    void vscode.window.showErrorMessage("No agents found in .harness/agents.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    agents.map((a) => ({
      label: a.name,
      description: a.model,
      detail: a.description,
    })),
    { title: "New Session", placeHolder: "Select an agent" },
  );
  return picked?.label;
}

/**
 * Prompt for a slug-safe name for a new/duplicated agent or skill, validating
 * live against the format rules and existing names. Returns the trimmed name, or
 * `undefined` when cancelled.
 */
async function promptForName(
  title: string,
  kind: "agent" | "skill",
  existing: readonly string[],
  value?: string,
): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title,
    prompt: `Name for the new ${kind} (lowercase, hyphen-separated)`,
    placeHolder: kind === "agent" ? "e.g. code-reviewer" : "e.g. api-design",
    value,
    validateInput: (v) => validateSlugName(v, existing),
    ignoreFocusOut: true,
  });
  return name?.trim() || undefined;
}

/**
 * Nudge the user to sync the CLI-generated stubs after a create/duplicate. The
 * extension writes only the `.harness/` source of truth; `harness doctor --fix`
 * regenerates the `.claude/` stubs — a step this extension must not do itself.
 */
function suggestHarnessDoctor(): void {
  void vscode.window.showInformationMessage(
    "Created in .harness/. Run `harness doctor --fix` to sync the generated stubs.",
  );
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Spawn a dedicated integrated terminal and run a `claude` command in it. */
function launchInTerminal(name: string, cwd: string, command: string): void {
  const terminal = vscode.window.createTerminal({ name, cwd });
  terminal.show();
  terminal.sendText(command);
}

export function deactivate(): void {
  // Nothing beyond context.subscriptions, which VS Code disposes.
}
