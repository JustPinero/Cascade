/**
 * Phase 23.3 — getUsageEvents tests.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import {
  getUsageEvents,
  computeHitRate,
} from "./usage-events";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

interface SeedRow {
  callSite: string;
  model?: string;
  inputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  createdAt?: Date;
}

async function seed(r: DispatchRig, rows: SeedRow[]): Promise<void> {
  for (const row of rows) {
    await r.prisma.anthropicUsageEvent.create({
      data: {
        callSite: row.callSite,
        model: row.model ?? "claude-sonnet-4-6",
        inputTokens: row.inputTokens ?? 100,
        cacheReadInputTokens: row.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: row.cacheCreationInputTokens ?? 0,
        outputTokens: row.outputTokens ?? 100,
        durationMs: row.durationMs ?? 500,
        ...(row.createdAt ? { createdAt: row.createdAt } : {}),
      },
    });
  }
}

describe("computeHitRate", () => {
  it("returns 1.0 when all input is from cache", () => {
    expect(
      computeHitRate({
        inputTokens: 0,
        cacheReadInputTokens: 1000,
        cacheCreationInputTokens: 0,
      })
    ).toBe(1);
  });

  it("returns 0 when only cache writes (no hits)", () => {
    expect(
      computeHitRate({
        inputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 1000,
      })
    ).toBe(0);
  });

  it("returns the correct ratio for a mix", () => {
    expect(
      computeHitRate({
        inputTokens: 250,
        cacheReadInputTokens: 500,
        cacheCreationInputTokens: 250,
      })
    ).toBe(0.5);
  });

  it("returns 0 when total tokens is 0 (no division by zero)", () => {
    expect(
      computeHitRate({
        inputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      })
    ).toBe(0);
  });
});

describe("getUsageEvents", () => {
  it("returns empty when no rows exist", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const result = await getUsageEvents(rig.prisma);
    expect(result.rows).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("filters by callSite", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      { callSite: "overseer.chat" },
      { callSite: "summarizer" },
      { callSite: "overseer.chat" },
    ]);
    const result = await getUsageEvents(rig.prisma, {
      callSite: "overseer.chat",
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.callSite === "overseer.chat")).toBe(true);
  });

  it("filters by model", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      { callSite: "x", model: "claude-sonnet-4-6" },
      { callSite: "x", model: "claude-haiku-4-5-20251001" },
    ]);
    const result = await getUsageEvents(rig.prisma, {
      model: "claude-haiku-4-5-20251001",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].model).toBe("claude-haiku-4-5-20251001");
  });

  it("filters by date range", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const old = new Date("2026-01-01T00:00:00Z");
    const recent = new Date("2026-05-01T00:00:00Z");
    await seed(rig, [
      { callSite: "x", createdAt: old },
      { callSite: "x", createdAt: recent },
    ]);
    const result = await getUsageEvents(rig.prisma, {
      since: new Date("2026-04-01T00:00:00Z"),
    });
    expect(result.rows).toHaveLength(1);
  });

  it("returns rows with computed hitRate", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await seed(rig, [
      {
        callSite: "x",
        inputTokens: 100,
        cacheReadInputTokens: 900,
        cacheCreationInputTokens: 0,
      },
    ]);
    const result = await getUsageEvents(rig.prisma);
    expect(result.rows[0].hitRate).toBe(0.9);
  });

  it("paginates with cursor and returns nextCursor when more rows exist", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const seedRows: SeedRow[] = [];
    for (let i = 0; i < 250; i++) seedRows.push({ callSite: `cs-${i}` });
    await seed(rig, seedRows);

    const page1 = await getUsageEvents(rig.prisma, { pageSize: 100 });
    expect(page1.rows).toHaveLength(100);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await getUsageEvents(rig.prisma, {
      pageSize: 100,
      cursorId: page1.nextCursor ?? undefined,
    });
    expect(page2.rows).toHaveLength(100);
    expect(page2.rows[0].id).toBeLessThan(page1.rows[page1.rows.length - 1].id);

    const page3 = await getUsageEvents(rig.prisma, {
      pageSize: 100,
      cursorId: page2.nextCursor ?? undefined,
    });
    expect(page3.rows).toHaveLength(50);
    expect(page3.nextCursor).toBeNull();
  });
});
