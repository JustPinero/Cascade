import { ToolRegistry } from "@/lib/overseer-tools";
import { queryProjectTool } from "@/lib/overseer-tools-query-project";

/**
 * Phase 12A.3 — default tool registry for the Overseer chat path.
 *
 * Future tools register here. Each call returns a fresh ToolRegistry
 * so request-scoped registries don't share mutable state.
 */
export function buildDefaultRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(queryProjectTool);
  return reg;
}
