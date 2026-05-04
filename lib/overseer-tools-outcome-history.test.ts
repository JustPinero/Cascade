/**
 * Phase 24.1 — query_outcome_history tool tests.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import { outcomeHistoryTool } from "./overseer-tools-outcome-history";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

interface SeedOutcome {
  mode: string;
  outcome: string;
  signals?: string[];
  daysAgo?: number;
}

async function seed(
  r: DispatchRig,
  slug: string,
  outcomes: SeedOutcome[]
): Promise<void> {
  const project = await r.createProject({ slug, path: `/p/${slug}` });
  for (const o of outcomes) {
    const completed = new Date(
      Date.now() - (o.daysAgo ?? 0) * 24 * 60 * 60 * 1000
    );
    await r.prisma.dispatchOutcome.create({
      data: {
        projectId: project.id,
        projectSlug: slug,
        mode: o.mode,
        healthAtDispatch: "healthy",
        outcome: o.outcome,
        signals: JSON.stringify(o.signals ?? []),
        dispatchedAt: completed,
        completedAt: completed,
      },
    });
  }
}

async function call(
  r: DispatchRig,
  input: Parameters<typeof outcomeHistoryTool.handler>[0]
) {
  return outcomeHistoryTool.handler(input, { prisma: r.prisma });
}

describe("query_outcome_history", () => {
  it("returns empty shape when no outcomes exist", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    const result = await call(rig, { slug: "alpha" });
    expect(result.totalDispatches).toBe(0);
    expect(result.byMode).toEqual({});
    expect(result.recentTimeline).toEqual([]);
    expect(result.summary).toBe("");
    expect(result.windowDays).toBe(14);
  });

  it("aggregates byMode counts and successRate", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, "alpha", [
      { mode: "audit", outcome: "success" },
      { mode: "audit", outcome: "success" },
      { mode: "audit", outcome: "blocker" },
      { mode: "continue", outcome: "success" },
    ]);
    const result = await call(rig, { slug: "alpha" });
    expect(result.totalDispatches).toBe(4);
    expect(result.byMode.audit.count).toBe(3);
    expect(result.byMode.audit.successRate).toBeCloseTo(2 / 3);
    expect(result.byMode.continue.count).toBe(1);
    expect(result.byMode.continue.successRate).toBe(1);
  });

  it("identifies recurring signals at the 50% threshold", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, "beta", [
      { mode: "audit", outcome: "attention-needed", signals: ["needs-attention"] },
      { mode: "audit", outcome: "attention-needed", signals: ["needs-attention"] },
      { mode: "audit", outcome: "blocker", signals: ["test-failure"] },
      { mode: "audit", outcome: "blocker", signals: ["test-failure", "needs-attention"] },
    ]);
    const result = await call(rig, { slug: "beta" });
    // needs-attention appears in 3 of 4 → recurring; test-failure in 2 of 4 → recurring (50% boundary).
    expect(result.byMode.audit.recurringSignals).toContain("needs-attention");
    expect(result.byMode.audit.recurringSignals).toContain("test-failure");
  });

  it("excludes outcomes outside the window", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, "gamma", [
      { mode: "continue", outcome: "success", daysAgo: 1 },
      { mode: "continue", outcome: "success", daysAgo: 30 }, // outside default 14-day window
    ]);
    const result = await call(rig, { slug: "gamma" });
    expect(result.totalDispatches).toBe(1);
  });

  it("respects custom windowDays", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, "delta", [
      { mode: "continue", outcome: "success", daysAgo: 1 },
      { mode: "continue", outcome: "success", daysAgo: 25 },
    ]);
    const result = await call(rig, { slug: "delta", windowDays: 30 });
    expect(result.totalDispatches).toBe(2);
    expect(result.windowDays).toBe(30);
  });

  it("limits recentTimeline to 5 most-recent entries", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const outcomes: SeedOutcome[] = [];
    for (let i = 0; i < 8; i++) {
      outcomes.push({ mode: "continue", outcome: "success", daysAgo: i });
    }
    await seed(rig, "epsilon", outcomes);
    const result = await call(rig, { slug: "epsilon" });
    expect(result.recentTimeline).toHaveLength(5);
  });

  it("emits a summary when conditions trigger", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, "zeta", [
      { mode: "audit", outcome: "success" },
      { mode: "audit", outcome: "success" },
      { mode: "audit", outcome: "success" },
    ]);
    const result = await call(rig, { slug: "zeta" });
    expect(result.summary).toContain("audits returned no actionable signals");
  });
});
