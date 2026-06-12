/**
 * Phase 39 [P8] — usage summary aggregation + cost math.
 */
import { describe, it, expect, vi } from "vitest";
import { getUsageSummary, estimateEventCostUsd } from "./usage-summary";

type EventRow = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
};

function makePrisma(rows: EventRow[]) {
  return {
    anthropicUsageEvent: {
      findMany: vi.fn(async () => rows),
    },
  } as unknown as Parameters<typeof getUsageSummary>[0];
}

function row(overrides: Partial<EventRow> = {}): EventRow {
  return {
    model: "claude-sonnet-4-6",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    ...overrides,
  };
}

describe("estimateEventCostUsd", () => {
  it("prices Sonnet 4.6 input and output at $3/$15 per MTok", () => {
    const cost = estimateEventCostUsd(
      row({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
    );
    expect(cost.usd).toBeCloseTo(3 + 15, 6);
    expect(cost.unknownModel).toBe(false);
  });

  it("prices Haiku 4.5 (dated full ID too) at $1/$5 per MTok", () => {
    const cost = estimateEventCostUsd(
      row({
        model: "claude-haiku-4-5-20251001",
        inputTokens: 2_000_000,
        outputTokens: 1_000_000,
      })
    );
    expect(cost.usd).toBeCloseTo(2 + 5, 6);
  });

  it("prices cache reads at 0.1x and 5m/1h writes at 1.25x/2x input", () => {
    const cost = estimateEventCostUsd(
      row({
        cacheReadInputTokens: 1_000_000, // 3 * 0.1  = 0.3
        cacheCreation5mTokens: 1_000_000, // 3 * 1.25 = 3.75
        cacheCreation1hTokens: 1_000_000, // 3 * 2    = 6
      })
    );
    expect(cost.usd).toBeCloseTo(0.3 + 3.75 + 6, 6);
  });

  it("falls back to pricing cacheCreationInputTokens as 5m when the tier split is absent", () => {
    const cost = estimateEventCostUsd(
      row({ cacheCreationInputTokens: 1_000_000 })
    );
    expect(cost.usd).toBeCloseTo(3.75, 6);
  });

  it("does not double-count cacheCreationInputTokens when the split is present", () => {
    const cost = estimateEventCostUsd(
      row({
        cacheCreationInputTokens: 1_000_000,
        cacheCreation5mTokens: 1_000_000,
      })
    );
    expect(cost.usd).toBeCloseTo(3.75, 6);
  });

  it("prices unknown models at Sonnet rates and flags them", () => {
    const cost = estimateEventCostUsd(
      row({ model: "claude-experimental-9", inputTokens: 1_000_000 })
    );
    expect(cost.usd).toBeCloseTo(3, 6);
    expect(cost.unknownModel).toBe(true);
  });
});

describe("getUsageSummary", () => {
  it("returns zeros on an empty range", async () => {
    const summary = await getUsageSummary(makePrisma([]), {
      since: new Date("2026-06-12T00:00:00"),
    });
    expect(summary).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      hitRate: 0,
      estimatedCostUsd: 0,
      hasUnknownModels: false,
    });
  });

  it("aggregates tokens, cost, and weighted hit rate across events", async () => {
    const prisma = makePrisma([
      row({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadInputTokens: 3_000_000,
      }),
      row({
        model: "claude-haiku-4-5-20251001",
        inputTokens: 1_000_000,
      }),
    ]);

    const summary = await getUsageSummary(prisma, {
      since: new Date("2026-06-12T00:00:00"),
    });

    expect(summary.calls).toBe(2);
    expect(summary.inputTokens).toBe(2_000_000);
    expect(summary.outputTokens).toBe(1_000_000);
    expect(summary.cacheReadTokens).toBe(3_000_000);
    // hitRate = cacheRead / (cacheRead + cacheCreation + input)
    expect(summary.hitRate).toBeCloseTo(3_000_000 / 5_000_000, 6);
    // Sonnet: 3 + 15 + 3*0.1 = 18.9; Haiku: 1. Total 19.9.
    expect(summary.estimatedCostUsd).toBeCloseTo(19.9, 6);
    expect(summary.hasUnknownModels).toBe(false);
  });

  it("passes the since filter through to the query", async () => {
    const prisma = makePrisma([]);
    const since = new Date("2026-06-12T00:00:00");
    await getUsageSummary(prisma, { since });

    const findMany = (
      prisma as unknown as {
        anthropicUsageEvent: { findMany: ReturnType<typeof vi.fn> };
      }
    ).anthropicUsageEvent.findMany;
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: since } },
      })
    );
  });
});
