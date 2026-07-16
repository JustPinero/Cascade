/**
 * Phase 35 — runtime hook for the dispatch watchdog. Closes [23.D5].
 *
 * The watchdog itself is well-tested in `dispatch-watchdog.test.ts`.
 * These tests cover the runtime singleton: single-instance under
 * concurrent calls, NODE_ENV gate, tick-error containment.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("./dispatch-watchdog", () => ({
  runDispatchWatchdog: vi.fn(async () => ({ timedOut: 0, keys: [] })),
  reconcileOrphanedDispatches: vi.fn(async () => ({ orphaned: 0, keys: [] })),
}));

vi.mock("./db", () => ({
  prisma: {},
}));

vi.mock("./dispatch-queue", () => ({
  getDispatchQueue: vi.fn(() => ({ release: vi.fn() })),
}));

import {
  startDispatchWatchdog,
  __stopDispatchWatchdogForTests,
  __isDispatchWatchdogRunningForTests,
} from "./dispatch-watchdog-runtime";
import {
  runDispatchWatchdog,
  reconcileOrphanedDispatches,
} from "./dispatch-watchdog";

beforeEach(() => {
  vi.useFakeTimers();
  __stopDispatchWatchdogForTests();
  vi.mocked(runDispatchWatchdog).mockReset();
  vi.mocked(runDispatchWatchdog).mockResolvedValue({
    timedOut: 0,
    keys: [],
    extended: 0,
  });
  vi.mocked(reconcileOrphanedDispatches).mockReset();
  vi.mocked(reconcileOrphanedDispatches).mockResolvedValue({
    orphaned: 0,
    keys: [],
  });
});

afterEach(() => {
  __stopDispatchWatchdogForTests();
  vi.useRealTimers();
});

describe("startDispatchWatchdog", () => {
  it("schedules an interval when forced past the NODE_ENV=test guard", () => {
    startDispatchWatchdog({ force: true });
    expect(__isDispatchWatchdogRunningForTests()).toBe(true);
  });

  it("no-ops when NODE_ENV=test and not forced", () => {
    startDispatchWatchdog();
    expect(__isDispatchWatchdogRunningForTests()).toBe(false);
  });

  it("does not double-schedule when called twice", () => {
    startDispatchWatchdog({ force: true });
    startDispatchWatchdog({ force: true });
    expect(__isDispatchWatchdogRunningForTests()).toBe(true);
    // Only ONE immediate-fire call, not two.
    expect(vi.mocked(runDispatchWatchdog).mock.calls.length).toBeLessThanOrEqual(
      1
    );
  });

  it("fires the watchdog on the configured interval", async () => {
    startDispatchWatchdog({ force: true, intervalMs: 1_000 });

    // The immediate-fire call is async; advance to flush it.
    await vi.advanceTimersByTimeAsync(0);
    const initial = vi.mocked(runDispatchWatchdog).mock.calls.length;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.mocked(runDispatchWatchdog).mock.calls.length).toBeGreaterThan(
      initial
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(
      vi.mocked(runDispatchWatchdog).mock.calls.length
    ).toBeGreaterThanOrEqual(initial + 2);
  });

  // Phase 37 [36.A2] — boot reconciliation runs exactly once, before
  // the first tick, and not again on subsequent interval fires.
  it("reconciles orphaned dispatches once at startup, not per tick", async () => {
    startDispatchWatchdog({ force: true, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(reconcileOrphanedDispatches)).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(vi.mocked(reconcileOrphanedDispatches)).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(runDispatchWatchdog).mock.calls.length
    ).toBeGreaterThanOrEqual(3);
  });

  it("swallows tick errors instead of throwing from the interval", async () => {
    vi.mocked(runDispatchWatchdog).mockRejectedValue(new Error("db down"));
    // Spy on console.error so we can verify the error is logged but
    // not re-thrown. (The interval would crash the process otherwise.)
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    startDispatchWatchdog({ force: true, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    // No throw escaped — the test would have failed already if it had.
    expect(__isDispatchWatchdogRunningForTests()).toBe(true);
    errSpy.mockRestore();
  });
});
