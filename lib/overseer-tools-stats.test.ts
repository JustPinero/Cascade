/**
 * Phase 24.2 — get_tool_call_stats tool tests.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import { toolCallStatsTool } from "./overseer-tools-stats";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

interface SeedEvent {
  sessionId: string;
  iteration?: number;
  toolName: string;
  success?: boolean;
  durationMs?: number;
  daysAgo?: number;
}

async function seed(r: DispatchRig, events: SeedEvent[]): Promise<void> {
  for (const e of events) {
    const createdAt = new Date(
      Date.now() - (e.daysAgo ?? 0) * 24 * 60 * 60 * 1000
    );
    await r.prisma.toolCallEvent.create({
      data: {
        sessionId: e.sessionId,
        iteration: e.iteration ?? 0,
        toolName: e.toolName,
        input: "{}",
        outputSize: 100,
        success: e.success ?? true,
        errorMessage: e.success === false ? "boom" : null,
        durationMs: e.durationMs ?? 50,
        createdAt,
      },
    });
  }
}

async function call(
  r: DispatchRig,
  input: Parameters<typeof toolCallStatsTool.handler>[0]
) {
  return toolCallStatsTool.handler(input, { prisma: r.prisma });
}

describe("get_tool_call_stats", () => {
  it("returns empty groups when no events exist", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const result = await call(rig, {});
    expect(result.totalCalls).toBe(0);
    expect(result.groups).toEqual([]);
    expect(result.groupBy).toBe("tool");
    expect(result.windowDays).toBe(7);
  });

  it("groups by tool by default and sorts by call count desc", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      { sessionId: "s1", toolName: "alpha" },
      { sessionId: "s1", toolName: "alpha" },
      { sessionId: "s1", toolName: "alpha" },
      { sessionId: "s1", toolName: "beta" },
    ]);
    const result = await call(rig, {});
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].group).toBe("alpha");
    expect(result.groups[0].totalCalls).toBe(3);
    expect(result.groups[1].group).toBe("beta");
  });

  it("computes success rate per group", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      { sessionId: "s1", toolName: "alpha", success: true },
      { sessionId: "s1", toolName: "alpha", success: true },
      { sessionId: "s1", toolName: "alpha", success: false },
      { sessionId: "s1", toolName: "alpha", success: false },
    ]);
    const result = await call(rig, {});
    expect(result.groups[0].successRate).toBe(0.5);
  });

  it("excludes events outside the window", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      { sessionId: "s1", toolName: "alpha", daysAgo: 1 },
      { sessionId: "s1", toolName: "alpha", daysAgo: 30 },
    ]);
    const result = await call(rig, { windowDays: 7 });
    expect(result.totalCalls).toBe(1);
  });

  it("respects sessionId filter", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      { sessionId: "s1", toolName: "alpha" },
      { sessionId: "s2", toolName: "alpha" },
    ]);
    const result = await call(rig, { sessionId: "s1" });
    expect(result.totalCalls).toBe(1);
  });

  it("supports groupBy: session", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      { sessionId: "s1", toolName: "alpha" },
      { sessionId: "s1", toolName: "beta" },
      { sessionId: "s2", toolName: "alpha" },
    ]);
    const result = await call(rig, { groupBy: "session" });
    expect(result.groupBy).toBe("session");
    expect(result.groups.find((g) => g.group === "s1")?.totalCalls).toBe(2);
    expect(result.groups.find((g) => g.group === "s2")?.totalCalls).toBe(1);
  });

  it("computes avg + p95 latency per group", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      { sessionId: "s1", toolName: "alpha", durationMs: 10 },
      { sessionId: "s1", toolName: "alpha", durationMs: 20 },
      { sessionId: "s1", toolName: "alpha", durationMs: 30 },
      { sessionId: "s1", toolName: "alpha", durationMs: 40 },
      { sessionId: "s1", toolName: "alpha", durationMs: 50 },
      { sessionId: "s1", toolName: "alpha", durationMs: 1000 },
    ]);
    const result = await call(rig, {});
    expect(result.groups[0].avgDurationMs).toBe(Math.round((10 + 20 + 30 + 40 + 50 + 1000) / 6));
    // p95 of 6 sorted values [10,20,30,40,50,1000], idx = floor(6*0.95) = 5 → 1000
    expect(result.groups[0].p95DurationMs).toBe(1000);
  });

  it("caps windowDays at 90", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const result = await call(rig, { windowDays: 365 });
    expect(result.windowDays).toBe(90);
  });
});
