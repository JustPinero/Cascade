/**
 * Phase 41.5 — runtime hook for the webhook spool drain.
 *
 * The drain itself is covered in `webhook-spool.test.ts`. These tests
 * cover the runtime singleton: single-instance under concurrent calls,
 * NODE_ENV gate, boot + interval firing, tick-error containment.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("./webhook-spool", () => ({
  drainWebhookSpool: vi.fn(async () => ({ ingested: 0, skipped: 0 })),
}));

vi.mock("./db", () => ({
  prisma: {},
}));

import {
  startSpoolDrain,
  __stopSpoolDrainForTests,
  __isSpoolDrainRunningForTests,
} from "./webhook-spool-runtime";
import { drainWebhookSpool } from "./webhook-spool";

beforeEach(() => {
  vi.useFakeTimers();
  __stopSpoolDrainForTests();
  vi.mocked(drainWebhookSpool).mockReset();
  vi.mocked(drainWebhookSpool).mockResolvedValue({ ingested: 0, skipped: 0 });
});

afterEach(() => {
  __stopSpoolDrainForTests();
  vi.useRealTimers();
});

describe("startSpoolDrain", () => {
  it("schedules an interval when forced past the NODE_ENV=test guard", () => {
    startSpoolDrain({ force: true });
    expect(__isSpoolDrainRunningForTests()).toBe(true);
  });

  it("no-ops when NODE_ENV=test and not forced", () => {
    startSpoolDrain();
    expect(__isSpoolDrainRunningForTests()).toBe(false);
  });

  it("does not double-schedule when called twice", () => {
    startSpoolDrain({ force: true });
    startSpoolDrain({ force: true });
    expect(__isSpoolDrainRunningForTests()).toBe(true);
    // Only ONE immediate-fire drain, not two.
    expect(vi.mocked(drainWebhookSpool).mock.calls.length).toBeLessThanOrEqual(
      1
    );
  });

  it("drains immediately at boot and again on the configured interval", async () => {
    startSpoolDrain({ force: true, intervalMs: 1_000 });

    // The immediate-fire drain is async; advance to flush it.
    await vi.advanceTimersByTimeAsync(0);
    const initial = vi.mocked(drainWebhookSpool).mock.calls.length;
    expect(initial).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.mocked(drainWebhookSpool).mock.calls.length).toBeGreaterThan(
      initial
    );
  });

  it("swallows tick errors instead of throwing from the interval", async () => {
    vi.mocked(drainWebhookSpool).mockRejectedValue(new Error("fs down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    startSpoolDrain({ force: true, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    // No throw escaped — the interval is still running.
    expect(__isSpoolDrainRunningForTests()).toBe(true);
    errSpy.mockRestore();
  });
});
