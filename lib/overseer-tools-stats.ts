/**
 * Phase 24.2 — get_tool_call_stats tool.
 *
 * Surfaces the Overseer's own tool-call telemetry to the model, so
 * "which tool do I call most this week?" / "is something failing?"
 * questions can be answered in conversation without a separate UI.
 *
 * Powered by ToolCallEvent rows written by runToolUseLoop. Pure
 * Prisma aggregations — no recursive Anthropic call.
 */
import type { Tool, ToolContext } from "@/lib/overseer-tools";

interface GetToolCallStatsInput {
  /** Default: current chat session if available; otherwise all. */
  sessionId?: string;
  /** Default 7. Capped at 90. */
  windowDays?: number;
  /** Default "tool". */
  groupBy?: "tool" | "session" | "iteration";
}

interface GroupAggregation {
  group: string;
  totalCalls: number;
  successes: number;
  failures: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

interface GetToolCallStatsOutput {
  windowDays: number;
  groupBy: "tool" | "session" | "iteration";
  totalCalls: number;
  groups: GroupAggregation[];
}

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export const toolCallStatsTool: Tool<GetToolCallStatsInput, GetToolCallStatsOutput> = {
  name: "get_tool_call_stats",
  description:
    "Read tool-call telemetry. Useful when the developer asks about which tools you use, why a session hit the iteration limit, or whether a tool keeps failing. Returns aggregated counts, success rates, and latency stats.",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Restrict to one ChatSession id. Default: current session if available.",
      },
      windowDays: {
        type: "number",
        description: `How many days back to aggregate. Default ${DEFAULT_WINDOW_DAYS}, max ${MAX_WINDOW_DAYS}.`,
      },
      groupBy: {
        type: "string",
        enum: ["tool", "session", "iteration"],
        description: "What to group by. Default 'tool'.",
      },
    },
  },
  handler: async (
    input: GetToolCallStatsInput,
    ctx: ToolContext
  ): Promise<GetToolCallStatsOutput> => {
    const windowDays = Math.min(
      input.windowDays ?? DEFAULT_WINDOW_DAYS,
      MAX_WINDOW_DAYS
    );
    const groupBy = input.groupBy ?? "tool";
    const sessionId = input.sessionId ?? ctx.sessionId;

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const where: Record<string, unknown> = { createdAt: { gte: since } };
    if (sessionId) where.sessionId = sessionId;

    const events = await ctx.prisma.toolCallEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    const buckets = new Map<string, { durations: number[]; successes: number; failures: number }>();
    for (const e of events) {
      let key: string;
      if (groupBy === "tool") key = e.toolName;
      else if (groupBy === "session") key = e.sessionId;
      else key = String(e.iteration);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { durations: [], successes: 0, failures: 0 };
        buckets.set(key, bucket);
      }
      bucket.durations.push(e.durationMs);
      if (e.success) bucket.successes += 1;
      else bucket.failures += 1;
    }

    const groups: GroupAggregation[] = Array.from(buckets.entries())
      .map(([group, b]) => ({
        group,
        totalCalls: b.durations.length,
        successes: b.successes,
        failures: b.failures,
        successRate:
          b.durations.length > 0 ? b.successes / b.durations.length : 0,
        avgDurationMs:
          b.durations.length > 0
            ? Math.round(
                b.durations.reduce((sum, d) => sum + d, 0) / b.durations.length
              )
            : 0,
        p95DurationMs: p95(b.durations),
      }))
      .sort((a, b) => b.totalCalls - a.totalCalls);

    return {
      windowDays,
      groupBy,
      totalCalls: events.length,
      groups,
    };
  },
};
