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
import { LiveSessionManager } from "./liveSessionManager";
import { SessionStatusMonitor } from "./sessionStatusMonitor";
import { loadAgents } from "./agentStore";

const VIEW_ID = "intelligents.agentsView";

// Watched globs — each mirrors a tree category source. All wired the same
// defensive way (create/change/delete -> refresh), matching the original agent
// watcher pattern.
const WATCH_GLOBS = [
  ".harness/agents/*.md",
  ".harness/skills/**/SKILL.md",
  ".harness/memories/*.md",
  ".harness/team-memories/team.md",
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
  let provider: AgentTreeProvider;
  let statusMonitor: SessionStatusMonitor;
  const liveSessions = new LiveSessionManager(
    root,
    context,
    () => provider.refresh(),
    (sessions) => statusMonitor.syncSessions(sessions),
  );
  statusMonitor = new SessionStatusMonitor(
    os.homedir(),
    () => provider.refresh(),
    (session) => liveSessions.reveal(session),
  );
  context.subscriptions.push({ dispose: () => statusMonitor.dispose() });
  provider = new AgentTreeProvider(sources, liveSessions, statusMonitor);
  const view = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
  });
  context.subscriptions.push(view);

  // Watch transcripts for any sessions restored from a previous window.
  statusMonitor.syncSessions(liveSessions.allSessions());

  // Drop records whose worktree was removed outside the extension.
  void liveSessions.reconcile();

  const mediaUri = vscode.Uri.joinPath(context.extensionUri, "media");
  const formPanel = new FormPanel(mediaUri, () => provider.refresh());
  context.subscriptions.push({ dispose: () => formPanel.dispose() });

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
        if (node?.kind === "liveSession") {
          await liveSessions.archive(node.session);
        }
      },
    ),
  );
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

/** Spawn a dedicated integrated terminal and run a `claude` command in it. */
function launchInTerminal(name: string, cwd: string, command: string): void {
  const terminal = vscode.window.createTerminal({ name, cwd });
  terminal.show();
  terminal.sendText(command);
}

export function deactivate(): void {
  // Nothing beyond context.subscriptions, which VS Code disposes.
}
