import { ToolRegistry } from "@/lib/overseer-tools";
import { queryProjectTool } from "@/lib/overseer-tools-query-project";
import { queryProjectsTool } from "@/lib/overseer-tools-query-projects";
import { recentActivityTool } from "@/lib/overseer-tools-recent-activity";
import { sessionLogsTool } from "@/lib/overseer-tools-session-logs";
import { dispatchOutcomesTool } from "@/lib/overseer-tools-dispatch-outcomes";
import { yesterdaySummaryTool } from "@/lib/overseer-tools-yesterday-summary";
import { engineerMessagesTool } from "@/lib/overseer-tools-engineer-messages";
import { playbookTool } from "@/lib/overseer-tools-playbook";
import { updateSessionMemoryTool } from "@/lib/overseer-tools-update-memory";
import { setActiveFlowTool } from "@/lib/overseer-tools-set-flow";
import { sessionStateTool } from "@/lib/overseer-tools-session-state";
import { proposeDispatchTool } from "@/lib/overseer-tools-propose-dispatch";
import { createReminderTool } from "@/lib/overseer-tools-create-reminder";
import { createHumanTodoTool } from "@/lib/overseer-tools-create-human-todo";
import { outcomeHistoryTool } from "@/lib/overseer-tools-outcome-history";
import { toolCallStatsTool } from "@/lib/overseer-tools-stats";

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
  // 12C.1 — working memory writes (the canonical place for
  // confirmed answers to land instead of being buried in prose)
  reg.register(updateSessionMemoryTool);
  reg.register(setActiveFlowTool);
  reg.register(sessionStateTool);
  // 12C.2 — structured outputs replacing tag emission
  reg.register(proposeDispatchTool);
  reg.register(createReminderTool);
  reg.register(createHumanTodoTool);
  // 24.1 — outcome-conditioned dispatch (propose-only). Read this
  // BEFORE proposing a dispatch so the recommendation reflects what
  // worked recently. Pure heuristic summary; no recursive Anthropic
  // call, so it's cheap to call on every dispatch turn.
  reg.register(outcomeHistoryTool);
  // 24.2 — tool-call telemetry self-introspection. Lets the Overseer
  // answer "which tools did I call most this week?" / "is something
  // failing?" from its own ToolCallEvent rows.
  reg.register(toolCallStatsTool);
  return reg;
}
