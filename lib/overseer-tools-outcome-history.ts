/**
 * Phase 24.1 — query_outcome_history tool.
 *
 * The Overseer calls this BEFORE proposing a dispatch so its
 * recommendation can be conditioned on what's worked recently.
 * Returns per-mode aggregations + a recent timeline + a heuristic
 * one-line summary (NOT a model call — see overseer-history-summary).
 */
import type { Tool, ToolContext } from "@/lib/overseer-tools";
import {
  generateSummary,
  type ByModeAggregation,
  type OutcomeTimelineEntry,
} from "@/lib/overseer-history-summary";

interface QueryOutcomeHistoryInput {
  slug: string;
  windowDays?: number;
}

interface QueryOutcomeHistoryOutput {
  slug: string;
  windowDays: number;
  totalDispatches: number;
  byMode: Record<string, ByModeAggregation>;
  recentTimeline: OutcomeTimelineEntry[];
  summary: string;
}

const DEFAULT_WINDOW_DAYS = 14;
const TIMELINE_SIZE = 5;
const RECURRING_SIGNAL_THRESHOLD = 0.5;

function parseSignals(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function computeRecurring(signalSets: string[][]): string[] {
  if (signalSets.length === 0) return [];
  const counts = new Map<string, number>();
  for (const sigs of signalSets) {
    const seen = new Set(sigs);
    for (const s of seen) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  const threshold = signalSets.length * RECURRING_SIGNAL_THRESHOLD;
  return Array.from(counts.entries())
    .filter(([, count]) => count >= threshold)
    .map(([sig]) => sig)
    .sort();
}

export const outcomeHistoryTool: Tool<
  QueryOutcomeHistoryInput,
  QueryOutcomeHistoryOutput
> = {
  name: "query_outcome_history",
  description:
    "Read recent dispatch outcomes for a project. Call this BEFORE proposing a dispatch — your recommendation should reflect what has worked recently. Returns per-mode counts, success rates, recurring signals, and a one-line summary.",
  inputSchema: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "Project slug to query history for.",
      },
      windowDays: {
        type: "number",
        description: `How many days back to look. Default ${DEFAULT_WINDOW_DAYS}.`,
      },
    },
    required: ["slug"],
  },
  handler: async (
    input: QueryOutcomeHistoryInput,
    ctx: ToolContext
  ): Promise<QueryOutcomeHistoryOutput> => {
    const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const outcomes = await ctx.prisma.dispatchOutcome.findMany({
      where: {
        projectSlug: input.slug,
        completedAt: { gte: since },
      },
      orderBy: { completedAt: "desc" },
    });

    // byMode aggregation
    const byMode: Record<string, ByModeAggregation> = {};
    const signalsByMode: Record<string, string[][]> = {};
    for (const o of outcomes) {
      const mode = o.mode;
      if (!byMode[mode]) {
        byMode[mode] = { count: 0, successRate: 0, recurringSignals: [] };
        signalsByMode[mode] = [];
      }
      byMode[mode].count += 1;
      if (o.outcome === "success") {
        byMode[mode].successRate += 1; // raw count for now
      }
      signalsByMode[mode].push(parseSignals(o.signals));
    }
    for (const mode of Object.keys(byMode)) {
      const agg = byMode[mode];
      agg.successRate = agg.count > 0 ? agg.successRate / agg.count : 0;
      agg.recurringSignals = computeRecurring(signalsByMode[mode]);
    }

    const recentTimeline: OutcomeTimelineEntry[] = outcomes
      .slice(0, TIMELINE_SIZE)
      .map((o) => ({
        date: o.completedAt.toISOString().slice(0, 10),
        mode: o.mode,
        outcome: o.outcome,
        signals: parseSignals(o.signals),
      }));

    const summary = generateSummary({
      byMode,
      recentTimeline,
      totalDispatches: outcomes.length,
    });

    return {
      slug: input.slug,
      windowDays,
      totalDispatches: outcomes.length,
      byMode,
      recentTimeline,
      summary,
    };
  },
};
