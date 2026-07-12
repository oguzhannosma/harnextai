import { homedir } from "node:os";
import { join } from "node:path";

export interface ToolAdapter {
  id: string;
  label: string;
  agentsDir: string;
  commandsDir: string;
  skillsDir: string;
  globalSkillsDir: string;
  supportsFileInclude: boolean;
  supportsAgentSkills: boolean;
}

export const ADAPTERS: Record<string, ToolAdapter> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    agentsDir: ".claude/agents",
    commandsDir: ".claude/commands",
    skillsDir: ".claude/skills",
    globalSkillsDir: join(homedir(), ".claude", "skills"),
    supportsFileInclude: true,
    supportsAgentSkills: true,
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    agentsDir: ".cursor/agents",
    commandsDir: ".cursor/commands",
    skillsDir: ".cursor/skills",
    globalSkillsDir: join(homedir(), ".cursor", "skills"),
    supportsFileInclude: true,
    supportsAgentSkills: false,
  },
};

export function knownAdapter(tool: string): ToolAdapter | undefined {
  return ADAPTERS[tool];
}
