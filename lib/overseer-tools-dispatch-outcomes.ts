import type { Tool } from "@/lib/overseer-tools";

interface DispatchOutcomesInput {
  projectSlug?: string;
  mode?: string;
  limit?: number;
}

interface ModeStats {
  total: number;
  success: number;
  blocker: number;
  successRate: number;
}

interface OutcomeRow {
  projectSlug: string;
  mode: string;
  outcome: string;
  healthAtDispatch: string;
  completedAtISO: string;
}

interface DispatchOutcomesOutput {
  totals: Record<string, ModeStats>;
  recentFailures: OutcomeRow[];
  totalSampled: number;
}

export const dispatchOutcomesTool: Tool<DispatchOutcomesInput, DispatchOutcomesOutput> = {
  name: "get_dispatch_outcomes",
  description:
    "Get aggregated dispatch outcome statistics — per-mode totals, success rates, and recent failures. Use this when calibrating dispatch recommendations or answering 'how reliable has investigate mode been?'",
  inputSchema: {
    type: "object",
    properties: {
      projectSlug: {
        type: "string",
        description: "Restrict aggregation to one project.",
      },
      mode: {
        type: "string",
        description: "Restrict to one dispatch mode (continue/audit/investigate/custom).",
      },
      limit: {
        type: "number",
        description: "Cap on outcome rows to sample. Default 50.",
      },
    },
  },
  handler: async (input, ctx) => {
    const limit = input.limit ?? 50;

    const where: { projectSlug?: string; mode?: string } = {};
    if (input.projectSlug) where.projectSlug = input.projectSlug;
    if (input.mode) where.mode = input.mode;

    const outcomes = await ctx.prisma.dispatchOutcome.findMany({
      where,
      orderBy: { completedAt: "desc" },
      take: limit,
    });

    const totals: Record<string, ModeStats> = {};
    for (const o of outcomes) {
      const stats = totals[o.mode] ?? { total: 0, success: 0, blocker: 0, successRate: 0 };
      stats.total++;
      if (o.outcome === "success") stats.success++;
      else stats.blocker++;
      totals[o.mode] = stats;
    }
    for (const stats of Object.values(totals)) {
      stats.successRate = stats.total === 0 ? 0 : stats.success / stats.total;
    }

    const recentFailures: OutcomeRow[] = outcomes
      .filter((o) => o.outcome !== "success")
      .slice(0, 5)
      .map((o) => ({
        projectSlug: o.projectSlug,
        mode: o.mode,
        outcome: o.outcome,
        healthAtDispatch: o.healthAtDispatch,
        completedAtISO: o.completedAt.toISOString(),
      }));

    return { totals, recentFailures, totalSampled: outcomes.length };
  },
};
