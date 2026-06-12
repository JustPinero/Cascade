/**
 * Phase 39 [P8] — route test for today's usage summary. Same @/lib/db
 * proxy-injection boilerplate as the other rig-based route tests.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("@/lib/db", () => {
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      const inj = (globalThis as Record<string, unknown>).__rigPrisma;
      if (!inj) {
        throw new Error("rig prisma not injected — set __rigPrisma in the test");
      }
      return (inj as Record<string, unknown>)[prop as string];
    },
  });
  return { prisma: proxy };
});

import { GET } from "./route";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  delete (globalThis as Record<string, unknown>).__rigPrisma;
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

describe("GET /api/usage/summary", () => {
  it("aggregates only today's events", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    (globalThis as Record<string, unknown>).__rigPrisma = rig.prisma;

    await rig.prisma.anthropicUsageEvent.create({
      data: {
        callSite: "overseer.chat",
        model: "claude-sonnet-4-6",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        durationMs: 1200,
      },
    });
    // Yesterday — must be excluded.
    await rig.prisma.anthropicUsageEvent.create({
      data: {
        callSite: "briefing",
        model: "claude-haiku-4-5-20251001",
        inputTokens: 5_000_000,
        outputTokens: 5_000_000,
        durationMs: 800,
        createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000),
      },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      calls: number;
      estimatedCostUsd: number;
      hitRate: number;
    };

    expect(body.calls).toBe(1);
    // Sonnet 4.6: 1M in ($3) + 1M out ($15).
    expect(body.estimatedCostUsd).toBeCloseTo(18, 6);
  });

  it("returns zeros when no events exist", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    (globalThis as Record<string, unknown>).__rigPrisma = rig.prisma;

    const res = await GET();
    const body = (await res.json()) as { calls: number; estimatedCostUsd: number };
    expect(body.calls).toBe(0);
    expect(body.estimatedCostUsd).toBe(0);
  });
});
