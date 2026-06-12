/**
 * Phase 39 [P8] — aggregate AnthropicUsageEvent rows into a spend
 * summary for the dashboard cost widget.
 *
 * MODEL_PRICING is a dated constants table (June 2026, USD per MTok) —
 * update it when Cascade's models change; it's greppable by name.
 * Cache reads bill at 0.1× input price; 5-minute cache writes at
 * 1.25×; 1-hour writes at 2×. When only the legacy aggregate
 * `cacheCreationInputTokens` is present (no 5m/1h split), it's priced
 * as 5m — the cheaper tier, so the estimate stays conservative-ish
 * without double counting.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-opus-4-8": { input: 5, output: 25 },
};
const FALLBACK_PRICING = MODEL_PRICING["claude-sonnet-4-6"];

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_5M_MULT = 1.25;
const CACHE_WRITE_1H_MULT = 2;
const MTOK = 1_000_000;

export interface UsageEventTokens {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
}

export interface EventCost {
  usd: number;
  unknownModel: boolean;
}

export function estimateEventCostUsd(event: UsageEventTokens): EventCost {
  const pricing = MODEL_PRICING[event.model];
  const { input, output } = pricing ?? FALLBACK_PRICING;

  // Prefer the 5m/1h split; fall back to the aggregate as 5m.
  const split5m =
    event.cacheCreation5mTokens > 0 || event.cacheCreation1hTokens > 0
      ? event.cacheCreation5mTokens
      : event.cacheCreationInputTokens;
  const split1h =
    event.cacheCreation5mTokens > 0 || event.cacheCreation1hTokens > 0
      ? event.cacheCreation1hTokens
      : 0;

  const usd =
    (event.inputTokens / MTOK) * input +
    (event.outputTokens / MTOK) * output +
    (event.cacheReadInputTokens / MTOK) * input * CACHE_READ_MULT +
    (split5m / MTOK) * input * CACHE_WRITE_5M_MULT +
    (split1h / MTOK) * input * CACHE_WRITE_1H_MULT;

  return { usd, unknownModel: pricing === undefined };
}

export interface UsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** cacheRead / (cacheRead + cacheCreation + uncached input); 0 when no input. */
  hitRate: number;
  estimatedCostUsd: number;
  /** True when any event's model wasn't in the pricing table (priced at Sonnet rates). */
  hasUnknownModels: boolean;
}

export async function getUsageSummary(
  prisma: PrismaClient,
  opts: { since: Date }
): Promise<UsageSummary> {
  const rows = await prisma.anthropicUsageEvent.findMany({
    where: { createdAt: { gte: opts.since } },
  });

  const summary: UsageSummary = {
    calls: rows.length,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    hitRate: 0,
    estimatedCostUsd: 0,
    hasUnknownModels: false,
  };

  for (const row of rows) {
    summary.inputTokens += row.inputTokens;
    summary.outputTokens += row.outputTokens;
    summary.cacheReadTokens += row.cacheReadInputTokens;
    summary.cacheCreationTokens += row.cacheCreationInputTokens;
    const cost = estimateEventCostUsd(row);
    summary.estimatedCostUsd += cost.usd;
    if (cost.unknownModel) summary.hasUnknownModels = true;
  }

  const totalInput =
    summary.cacheReadTokens + summary.cacheCreationTokens + summary.inputTokens;
  summary.hitRate = totalInput === 0 ? 0 : summary.cacheReadTokens / totalInput;

  return summary;
}
