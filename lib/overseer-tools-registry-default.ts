import { ToolRegistry } from "@/lib/overseer-tools";
import { queryProjectTool } from "@/lib/overseer-tools-query-project";
import { queryProjectsTool } from "@/lib/overseer-tools-query-projects";
import { recentActivityTool } from "@/lib/overseer-tools-recent-activity";
import { sessionLogsTool } from "@/lib/overseer-tools-session-logs";
import { dispatchOutcomesTool } from "@/lib/overseer-tools-dispatch-outcomes";
import { yesterdaySummaryTool } from "@/lib/overseer-tools-yesterday-summary";
import { engineerMessagesTool } from "@/lib/overseer-tools-engineer-messages";
import { playbookTool } from "@/lib/overseer-tools-playbook";

/**
 * Default tool registry for the Overseer chat path.
 *
 * Future tools register here. Each call returns a fresh ToolRegistry
 * so request-scoped registries don't share mutable state.
 */
export function buildDefaultRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  // 12A.3 — single-project state lookup
  reg.register(queryProjectTool);
  // 12B.1 — fleet-visibility read tools (replace SP-injected blocks)
  reg.register(queryProjectsTool);
  reg.register(recentActivityTool);
  reg.register(sessionLogsTool);
  reg.register(dispatchOutcomesTool);
  // 12B.2 — memo-style read tools (replace remaining SP blocks)
  reg.register(yesterdaySummaryTool);
  reg.register(engineerMessagesTool);
  reg.register(playbookTool);
  return reg;
}
