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
import { WorkflowIssuesTreeProvider, WorkflowIssuesNode } from "./workflowTree";
import {
  WorkflowSessionsViewProvider,
  WORKFLOW_SESSIONS_VIEW_ID,
} from "./workflowSessionsView";
import {
  WorkflowGraphViewProvider,
  WORKFLOW_GRAPH_VIEW_ID,
} from "./workflowGraphView";
import {
  HarnessDoctorViewProvider,
  HARNESS_DOCTOR_VIEW_ID,
} from "./harnessDoctorView";
import { WorkflowProgressMonitor } from "./workflowProgressMonitor";
import { WorkflowAttentionNotifier } from "./workflowAttention";
import { resumeProgressFile } from "./workflowProgressActions";
import { loadHarnessWorkflow } from "./harnessWorkflow";
import {
  WorkflowRuntime,
  isWorkflowRuntime,
  runtimeLabel,
} from "./workflowRuntime";
import { loadAgents, duplicateAgent } from "./agentStore";
import { loadSkills } from "./skillStore";
import { hasHarness } from "./harness/project";
import { ensureHarness } from "./harness/ensure";
import {
  buildArchitectCommand,
  buildSetupArchitectCommand,
  type ArchitectBrief,
} from "./harness/architectPrompt";
import { deleteHistorySession, SessionInfo } from "./sessionStore";
import { LiveSession, issueNumberFromSlug } from "./liveSessionStore";
import { validateSlugName } from "./naming";
import { approveProposal, rejectProposal } from "./pendingMemoryStore";

const VIEW_ID = "harnextai.agentsView";
const WORKFLOW_ISSUES_VIEW_ID = "harnextai.workflowIssuesView";

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
  let workflowSessionsProvider: WorkflowSessionsViewProvider;
  let workflowIssuesProvider: WorkflowIssuesTreeProvider;
  let workflowGraph!: WorkflowGraphViewProvider;
  let workflowProgress!: WorkflowProgressMonitor;
  let harnessDoctor!: HarnessDoctorViewProvider;
  const issueTitles = new Map<number, string>();
  const attention = new WorkflowAttentionNotifier();

  const liveSessions = new LiveSessionManager(
    root,
    context,
    () => provider.refresh(),
    (sessions) => {
      statusMonitor.syncSessions(sessions);
      workflowProgress.syncSessions(sessions);
      statusBar.refresh();
      workflowSessionsProvider.refresh();
      workflowIssuesProvider.refresh();
      attention.observe(workflowProgress.getHighlight());
    },
  );

  const findIssueSession = (issueNumber: number): LiveSession | undefined =>
    liveSessions
      .allSessions()
      .find((s) => !s.archived && issueNumberFromSlug(s.slug) === issueNumber);

  const openWorkflowTerminal = (issueNumber: number): void => {
    const session = findIssueSession(issueNumber);
    if (session) {
      liveSessions.reveal(session);
    }
  };

  const continueWorkflow = async (issueNumber: number): Promise<void> => {
    const session = findIssueSession(issueNumber);
    if (!session) {
      void vscode.window.showWarningMessage(
        `No live workflow session for issue #${issueNumber}.`,
      );
      return;
    }
    const ok = await resumeProgressFile(session.worktreePath);
    if (!ok) {
      void vscode.window.showWarningMessage(
        `Could not update progress.md for #${issueNumber}.`,
      );
    }
    liveSessions.nudge(
      session,
      "User approved from the Workflow panel — please continue.",
    );
    workflowProgress.reloadSlug(session.slug);
    workflowGraph.refresh();
    workflowSessionsProvider.refresh();
  };

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
    canSelectMany: true,
  });
  context.subscriptions.push(view);

  const mediaUri = vscode.Uri.joinPath(context.extensionUri, "media");
  const architectSkillSourceDir = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "harness-architect",
  ).fsPath;

  const refreshHarnessSurfaces = (): void => {
    provider.refresh();
    harnessDoctor.refresh();
    workflowGraph.refresh();
  };

  workflowProgress = new WorkflowProgressMonitor(() => {
    workflowGraph.refresh();
    workflowSessionsProvider.refresh();
    workflowIssuesProvider.refresh();
    statusBar.refresh();
    attention.observe(workflowProgress.getHighlight());
  });
  context.subscriptions.push({
    dispose: () => workflowProgress.dispose(),
  });
  statusBar.setProgressQuery(workflowProgress);

  workflowGraph = new WorkflowGraphViewProvider(
    mediaUri,
    root,
    workflowProgress,
    continueWorkflow,
    openWorkflowTerminal,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WORKFLOW_GRAPH_VIEW_ID,
      workflowGraph,
    ),
  );

  workflowSessionsProvider = new WorkflowSessionsViewProvider(
    mediaUri,
    liveSessions,
    workflowProgress,
    (session) => liveSessions.reveal(session),
    async (session) => {
      await liveSessions.delete(session);
    },
    (issue) => issueTitles.get(issue),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WORKFLOW_SESSIONS_VIEW_ID,
      workflowSessionsProvider,
    ),
  );

  harnessDoctor = new HarnessDoctorViewProvider(mediaUri, root, {
    onBootstrapRequest: () =>
      vscode.commands.executeCommand("harnextai.bootstrapHarness"),
    onFixed: refreshHarnessSurfaces,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      HARNESS_DOCTOR_VIEW_ID,
      harnessDoctor,
    ),
  );

  workflowIssuesProvider = new WorkflowIssuesTreeProvider(
    root,
    findIssueSession,
    workflowProgress,
  );
  const workflowIssuesView = vscode.window.createTreeView(
    WORKFLOW_ISSUES_VIEW_ID,
    { treeDataProvider: workflowIssuesProvider },
  );
  context.subscriptions.push(workflowIssuesView);

  const refreshIssueTitles = async (): Promise<void> => {
    try {
      const nodes = await workflowIssuesProvider.getChildren();
      issueTitles.clear();
      for (const node of nodes) {
        if (node.kind === "issue") {
          issueTitles.set(node.issue.number, node.issue.title);
        }
      }
      workflowSessionsProvider.refresh();
    } catch {
      // best-effort
    }
  };
  void refreshIssueTitles();
  const originalIssuesRefresh = workflowIssuesProvider.refresh.bind(
    workflowIssuesProvider,
  );
  workflowIssuesProvider.refresh = () => {
    originalIssuesRefresh();
    void refreshIssueTitles();
  };

  const harnessJsonWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, ".harness/harness.json"),
  );
  const refreshWorkflowGraph = () => {
    workflowGraph.refresh();
    harnessDoctor.refresh();
  };
  harnessJsonWatcher.onDidCreate(refreshWorkflowGraph);
  harnessJsonWatcher.onDidChange(refreshWorkflowGraph);
  harnessJsonWatcher.onDidDelete(refreshWorkflowGraph);
  context.subscriptions.push(harnessJsonWatcher);

  // Watch transcripts and progress for any sessions restored from a previous window.
  void (async () => {
    await liveSessions.reconcile();
    const sessions = liveSessions.allSessions();
    statusMonitor.syncSessions(sessions);
    workflowProgress.syncSessions(sessions);
    statusBar.refresh();
    provider.refresh();
  })();

  const worktreesWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      workspaceFolder,
      ".harness/agent-session-works/**",
    ),
  );
  const reconcileWorktrees = () => void liveSessions.reconcile();
  worktreesWatcher.onDidDelete(reconcileWorktrees);
  worktreesWatcher.onDidCreate(reconcileWorktrees);
  context.subscriptions.push(worktreesWatcher);
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        reconcileWorktrees();
      }
    }),
  );

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
    const onHarnessChange = () => {
      provider.refresh();
      harnessDoctor.refresh();
    };
    watcher.onDidCreate(onHarnessChange, undefined, context.subscriptions);
    watcher.onDidChange(onHarnessChange, undefined, context.subscriptions);
    watcher.onDidDelete(onHarnessChange, undefined, context.subscriptions);
    context.subscriptions.push(watcher);
  }

  if (!hasHarness(root)) {
    void vscode.window
      .showInformationMessage(
        "This workspace has no `.harness/` yet. Initialize a harness skeleton to manage agents and skills.",
        "Initialize Harness",
        "Open Doctor",
      )
      .then((choice) => {
        if (choice === "Initialize Harness") {
          void vscode.commands.executeCommand("harnextai.bootstrapHarness");
        } else if (choice === "Open Doctor") {
          void vscode.commands.executeCommand("harnextai.showHarnessDoctor");
        }
      });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("harnextai.refresh", () => {
      void liveSessions.reconcile().then(() => {
        provider.refresh();
        harnessDoctor.refresh();
      });
    }),
    vscode.commands.registerCommand("harnextai.bootstrapHarness", async () => {
      try {
        if (hasHarness(root)) {
          void vscode.window.showInformationMessage(
            "Harness already exists in this workspace.",
          );
          harnessDoctor.refresh();
          return;
        }
        const runtime = await pickHarnessRuntime();
        if (!runtime) {
          return;
        }
        const result = await ensureHarness(root, {
          tools: [runtime],
          architectSkillSourceDir,
        });
        refreshHarnessSurfaces();
        await vscode.commands.executeCommand(
          "workbench.view.extension.harnextai",
        );
        void vscode.commands.executeCommand(
          "harnextai.harnessDoctorView.focus",
        );
        if (result.bootstrapped) {
          launchInTerminal(
            "Harness Architect",
            root,
            buildSetupArchitectCommand(runtime, root),
          );
        }
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Failed to initialize harness: ${errText(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand("harnextai.showHarnessDoctor", async () => {
      await vscode.commands.executeCommand(
        "workbench.view.extension.harnextai",
      );
      await vscode.commands.executeCommand("harnextai.harnessDoctorView.focus");
      harnessDoctor.refresh();
    }),
    vscode.commands.registerCommand("harnextai.fixHarnessDoctor", async () => {
      const actions = await harnessDoctor.fixAll();
      if (actions.length === 0) {
        void vscode.window.showInformationMessage("Doctor: nothing to fix.");
      } else {
        void vscode.window.showInformationMessage(
          `Doctor applied ${actions.length} fix${actions.length === 1 ? "" : "es"}.`,
        );
      }
    }),
    vscode.commands.registerCommand("harnextai.newAgent", async () => {
      const initRuntime = await ensureHarnessForArchitect(
        root,
        architectSkillSourceDir,
      );
      if (initRuntime === "cancelled") {
        return;
      }
      refreshHarnessSurfaces();
      const existing = (await loadAgents(sources.agentsDir)).map((a) => a.name);
      const brief = await promptForArchitectBrief(
        "New Agent",
        "agent",
        existing,
      );
      if (!brief) {
        return;
      }
      const runtime = initRuntime ?? (await resolveWorkflowRuntime());
      if (!runtime) {
        return;
      }
      launchInTerminal(
        `Architect — ${brief.name}`,
        root,
        buildArchitectCommand(runtime, root, {
          kind: "extend-agent",
          name: brief.name,
          purpose: brief.purpose,
          notes: brief.notes,
        }),
      );
      harnessDoctor.refresh();
    }),
    vscode.commands.registerCommand("harnextai.newSkill", async () => {
      const initRuntime = await ensureHarnessForArchitect(
        root,
        architectSkillSourceDir,
      );
      if (initRuntime === "cancelled") {
        return;
      }
      refreshHarnessSurfaces();
      const existing = (await loadSkills(sources.skillsDir)).map((s) => s.name);
      const brief = await promptForArchitectBrief(
        "New Skill",
        "skill",
        existing,
      );
      if (!brief) {
        return;
      }
      const runtime = initRuntime ?? (await resolveWorkflowRuntime());
      if (!runtime) {
        return;
      }
      launchInTerminal(
        `Architect — ${brief.name}`,
        root,
        buildArchitectCommand(runtime, root, {
          kind: "extend-skill",
          name: brief.name,
          purpose: brief.purpose,
          notes: brief.notes,
        }),
      );
      harnessDoctor.refresh();
    }),
    vscode.commands.registerCommand(
      "harnextai.duplicateAgent",
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
        harnessDoctor.refresh();
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.approveProposal",
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
      "harnextai.rejectProposal",
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
      "harnextai.openForm",
      (arg: OpenFormArg) => {
        if (arg && typeof arg.filePath === "string" && arg.kind) {
          void formPanel.open(arg);
        }
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.launchAgent",
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
      "harnextai.resumeSession",
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
      "harnextai.newSession",
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
      "harnextai.revealSession",
      (node: TreeNode) => {
        if (node?.kind === "liveSession") {
          liveSessions.reveal(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.archiveSession",
      async (node: TreeNode) => {
        if (node?.kind === "liveSession" && !node.session.archived) {
          await liveSessions.archive(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.deleteSession",
      async (node?: TreeNode, selected?: TreeNode[]) => {
        const sessions = collectDeletableSessions(node, selected);
        if (sessions.length === 0) {
          return;
        }
        await liveSessions.deleteMany(sessions);
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.sendMessage",
      async (node: TreeNode) => {
        if (node?.kind === "liveSession" && !node.session.archived) {
          await liveSessions.sendMessage(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.reviewSession",
      async (node: TreeNode) => {
        if (node?.kind === "liveSession" && !node.session.archived) {
          await liveSessions.reviewSession(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.mergeSession",
      async (node: TreeNode) => {
        if (node?.kind === "liveSession" && !node.session.archived) {
          await liveSessions.mergeSession(node.session);
        }
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.openWorktree",
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
      "harnextai.deleteHistorySession",
      async (node?: TreeNode, selected?: TreeNode[]) => {
        const sessions = collectHistorySessions(node, selected);
        if (sessions.length === 0) {
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          sessions.length === 1
            ? `Delete this session transcript? This removes it permanently — it cannot be resumed afterward.`
            : `Delete ${sessions.length} session transcripts? This removes them permanently — they cannot be resumed afterward.`,
          { modal: true },
          "Delete",
        );
        if (confirm !== "Delete") {
          return;
        }
        const failures: string[] = [];
        for (const session of sessions) {
          try {
            await deleteHistorySession(
              sources.homeDir,
              session.filePath,
              session.sessionId,
            );
          } catch (err) {
            failures.push(
              `${session.sessionId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        provider.refresh();
        if (failures.length > 0) {
          void vscode.window.showErrorMessage(
            `Failed to delete ${failures.length} transcript(s):\n${failures.join("\n")}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.viewTranscript",
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
    vscode.commands.registerCommand("harnextai.showMemoryPanel", () => {
      void memoryPanel.open();
    }),
    vscode.commands.registerCommand("harnextai.refreshWorkflow", () => {
      workflowGraph.refresh();
      workflowIssuesProvider.refresh();
      workflowSessionsProvider.refresh();
    }),
    vscode.commands.registerCommand(
      "harnextai.triggerWorkflow",
      async (node: WorkflowIssuesNode) => {
        if (node?.kind !== "issue") {
          return;
        }
        const runtime = await resolveWorkflowRuntime();
        if (!runtime) {
          return;
        }
        const wf = await loadHarnessWorkflow(root);
        const trigger = wf.ok ? wf.workflow.trigger : undefined;
        const issueNumber = node.issue.number;
        await liveSessions.startWorkflowFromIssue(
          issueNumber,
          runtime,
          trigger,
        );
        const slug = `issue-${issueNumber}`;
        workflowProgress.reloadSlug(slug);
        workflowGraph.refresh();
        workflowSessionsProvider.refresh();
        workflowIssuesProvider.refresh();
        void vscode.commands.executeCommand(`${WORKFLOW_GRAPH_VIEW_ID}.focus`);
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.revealWorkflowSession",
      (node: WorkflowIssuesNode) => {
        if (node?.kind === "issue") {
          const session = findIssueSession(node.issue.number);
          if (session) {
            liveSessions.reveal(session);
          }
        }
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.openIssueOnGitHub",
      async (node: WorkflowIssuesNode) => {
        if (node?.kind !== "issue" || !node.issue.url) {
          return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(node.issue.url));
      },
    ),
    vscode.commands.registerCommand(
      "harnextai.openWorkflowTerminalByIssue",
      (issueNumber: number) => {
        if (typeof issueNumber === "number") {
          openWorkflowTerminal(issueNumber);
        }
      },
    ),
  );
}

/**
 * Always-prompt picker for Initialize Harness / first-time Architect flows.
 */
async function pickHarnessRuntime(
  title = "Initialize Harness",
): Promise<WorkflowRuntime | undefined> {
  const runtimes: WorkflowRuntime[] = ["claude", "cursor"];
  const picked = await vscode.window.showQuickPick(
    runtimes.map((runtime) => ({
      label: runtimeLabel(runtime),
      description:
        runtime === "claude"
          ? "Enable Claude stubs (.claude/) and launch claude"
          : "Enable Cursor stubs (.cursor/) and launch agent",
      runtime,
    })),
    {
      title,
      placeHolder: "Which coding tool should this harness target?",
    },
  );
  return picked?.runtime;
}

/**
 * Ensure `.harness/` exists. When bootstrapping, always ask Claude vs Cursor
 * and enable that tool. Returns the runtime chosen for bootstrap (so callers
 * can reuse it), `undefined` if harness already existed, or `"cancelled"`.
 */
async function ensureHarnessForArchitect(
  repoRoot: string,
  architectSkillSourceDir: string,
): Promise<WorkflowRuntime | undefined | "cancelled"> {
  if (hasHarness(repoRoot)) {
    return undefined;
  }
  const runtime = await pickHarnessRuntime();
  if (!runtime) {
    return "cancelled";
  }
  try {
    await ensureHarness(repoRoot, {
      tools: [runtime],
      architectSkillSourceDir,
    });
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Failed to ensure harness: ${errText(err)}`,
    );
    return "cancelled";
  }
  return runtime;
}

/**
 * Resolve which runtime a Trigger Workflow run should use. Reads the
 * `harnextai.workflow.*` settings: when `useDefaultRuntime` is true, returns
 * `defaultRuntime` with no prompt; otherwise shows a QuickPick (Claude Code /
 * Cursor CLI) pre-selecting the default. Returns `undefined` when the user
 * cancels the picker.
 */
async function resolveWorkflowRuntime(): Promise<WorkflowRuntime | undefined> {
  const config = vscode.workspace.getConfiguration("harnextai.workflow");
  const rawDefault = config.get<string>("defaultRuntime", "claude");
  const defaultRuntime: WorkflowRuntime = isWorkflowRuntime(rawDefault)
    ? rawDefault
    : "claude";
  const useDefault = config.get<boolean>("useDefaultRuntime", true);
  if (useDefault) {
    return defaultRuntime;
  }
  const runtimes: WorkflowRuntime[] = ["claude", "cursor"];
  const picked = await vscode.window.showQuickPick(
    runtimes.map((runtime) => ({
      label: runtimeLabel(runtime),
      description: runtime === defaultRuntime ? "default" : undefined,
      runtime,
    })),
    {
      title: "Trigger Workflow",
      placeHolder: "Choose the runtime to launch",
    },
  );
  return picked?.runtime;
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

async function promptForArchitectBrief(
  title: string,
  kind: "agent" | "skill",
  existing: readonly string[],
): Promise<(ArchitectBrief & { name: string; purpose: string }) | undefined> {
  const name = await promptForName(title, kind, existing);
  if (!name) {
    return undefined;
  }
  const purpose = await vscode.window.showInputBox({
    title: `${title} — purpose`,
    prompt: `What should this ${kind} do? (one or two sentences)`,
    placeHolder:
      kind === "agent"
        ? "e.g. Review PRs for correctness and test coverage"
        : "e.g. Rules for editing VS Code extension source",
    ignoreFocusOut: true,
    validateInput: (v) =>
      v.trim().length < 8 ? "Please enter at least 8 characters." : undefined,
  });
  if (!purpose?.trim()) {
    return undefined;
  }
  const notes = await vscode.window.showInputBox({
    title: `${title} — extra notes (optional)`,
    prompt: "Optional constraints, tools, or examples for the architect",
    ignoreFocusOut: true,
  });
  return {
    kind: kind === "agent" ? "extend-agent" : "extend-skill",
    name,
    purpose: purpose.trim(),
    notes: notes?.trim() || undefined,
  };
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

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolve the set of live/archived session nodes a delete command should act on.
 * VS Code passes `(focused, selected[])` from multi-select context menus.
 */
function collectDeletableSessions(
  node: TreeNode | undefined,
  selected: TreeNode[] | undefined,
): LiveSession[] {
  const candidates =
    Array.isArray(selected) && selected.length > 0
      ? selected
      : node
        ? [node]
        : [];
  const seen = new Set<string>();
  const out: LiveSession[] = [];
  for (const n of candidates) {
    if (n?.kind !== "liveSession") {
      continue;
    }
    if (seen.has(n.session.slug)) {
      continue;
    }
    seen.add(n.session.slug);
    out.push(n.session);
  }
  return out;
}

/**
 * Same selection resolution as {@link collectLiveSessions}, for Session History
 * transcript nodes (`kind: "session"`).
 */
function collectHistorySessions(
  node: TreeNode | undefined,
  selected: TreeNode[] | undefined,
): SessionInfo[] {
  const candidates =
    Array.isArray(selected) && selected.length > 0
      ? selected
      : node
        ? [node]
        : [];
  const seen = new Set<string>();
  const out: SessionInfo[] = [];
  for (const n of candidates) {
    if (n?.kind !== "session") {
      continue;
    }
    if (seen.has(n.session.sessionId)) {
      continue;
    }
    seen.add(n.session.sessionId);
    out.push(n.session);
  }
  return out;
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
