/**
 * Phase 23.3 — logUsage + extractUsageFields tests.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import { logUsage, extractUsageFields } from "./anthropic-usage-log";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

async function flushMicrotasks() {
  // queueMicrotask defers the insert one tick; setImmediate flushes
  // the microtask queue. Then we wait for the prisma promise to
  // settle. 500ms is comfortably long enough even when test workers
  // are competing for SQLite locks; the prior 50ms was racy under
  // parallel-worker load.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 500));
}

describe("extractUsageFields", () => {
  it("returns all-zero defaults when usage is undefined", () => {
    const fields = extractUsageFields(undefined);
    expect(fields).toEqual({
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      outputTokens: 0,
    });
  });

  it("extracts plain input/output tokens when no cache fields are present", () => {
    const fields = extractUsageFields({ input_tokens: 100, output_tokens: 50 });
    expect(fields.inputTokens).toBe(100);
    expect(fields.outputTokens).toBe(50);
    expect(fields.cacheReadInputTokens).toBe(0);
    expect(fields.cacheCreationInputTokens).toBe(0);
  });

  it("surfaces cache hit + write tokens at the top level", () => {
    const fields = extractUsageFields({
      input_tokens: 50,
      output_tokens: 100,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 1500,
    });
    expect(fields.cacheReadInputTokens).toBe(5000);
    expect(fields.cacheCreationInputTokens).toBe(1500);
  });

  it("preserves the 5m/1h cache_creation split", () => {
    const fields = extractUsageFields({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation: {
        ephemeral_5m_input_tokens: 2000,
        ephemeral_1h_input_tokens: 800,
      },
    });
    expect(fields.cacheCreation5mTokens).toBe(2000);
    expect(fields.cacheCreation1hTokens).toBe(800);
  });
});

describe("logUsage", () => {
  it("inserts a row with all fields populated", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    logUsage(rig.prisma, {
      callSite: "overseer.chat",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 1500,
        cache_creation: {
          ephemeral_5m_input_tokens: 1500,
          ephemeral_1h_input_tokens: 0,
        },
      },
      durationMs: 1234,
    });
    await flushMicrotasks();
    const rows = await rig.prisma.anthropicUsageEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      callSite: "overseer.chat",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      cacheReadInputTokens: 5000,
      cacheCreationInputTokens: 1500,
      cacheCreation5mTokens: 1500,
      cacheCreation1hTokens: 0,
      outputTokens: 200,
      durationMs: 1234,
    });
  });

  it("does not block the caller — returns synchronously", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const start = performance.now();
    logUsage(rig.prisma, {
      callSite: "summarizer",
      model: "claude-haiku-4-5-20251001",
      usage: { input_tokens: 50, output_tokens: 30 },
      durationMs: 500,
    });
    const elapsed = performance.now() - start;
    // The synchronous portion of logUsage is just one queueMicrotask
    // schedule — must complete in <5ms even on a slow CI box.
    expect(elapsed).toBeLessThan(5);
  });

  it("swallows insert errors and never throws to the caller", async () => {
    // Build a stub prisma whose anthropicUsageEvent.create rejects.
    const failingPrisma = {
      anthropicUsageEvent: {
        create: vi.fn(async () => {
          throw new Error("simulated DB failure");
        }),
      },
    } as unknown as Parameters<typeof logUsage>[0];

    expect(() =>
      logUsage(failingPrisma, {
        callSite: "test",
        model: "test",
        usage: undefined,
        durationMs: 0,
      })
    ).not.toThrow();
    // Allow microtask to run; .catch should swallow.
    await flushMicrotasks();
  });

  it("zero-defaults cache columns when response usage omits them", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    logUsage(rig.prisma, {
      callSite: "feature-proposer",
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 200, output_tokens: 400 },
      durationMs: 800,
    });
    await flushMicrotasks();
    const row = await rig.prisma.anthropicUsageEvent.findFirst();
    expect(row?.cacheReadInputTokens).toBe(0);
    expect(row?.cacheCreationInputTokens).toBe(0);
    expect(row?.cacheCreation5mTokens).toBe(0);
    expect(row?.cacheCreation1hTokens).toBe(0);
  });
});
