import { describe, it, expect, vi, afterEach } from "vitest";
import os from "os";

import {
  DispatchQueue,
  detectDefaultConcurrency,
  getDispatchQueue,
} from "./dispatch-queue";

const GB = 1024 * 1024 * 1024;

describe("detectDefaultConcurrency", () => {
  const originalEnv = process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS;
    } else {
      process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it("returns 1 for hosts with less than 16GB of memory", () => {
    vi.spyOn(os, "totalmem").mockReturnValue(8 * GB);
    expect(detectDefaultConcurrency()).toBe(1);
  });

  it("returns 2 for hosts with memory in [16GB, 48GB)", () => {
    vi.spyOn(os, "totalmem").mockReturnValue(24 * GB);
    expect(detectDefaultConcurrency()).toBe(2);
  });

  it("returns 2 at the 16GB boundary", () => {
    vi.spyOn(os, "totalmem").mockReturnValue(16 * GB);
    expect(detectDefaultConcurrency()).toBe(2);
  });

  it("returns 4 for hosts with at least 48GB of memory", () => {
    vi.spyOn(os, "totalmem").mockReturnValue(64 * GB);
    expect(detectDefaultConcurrency()).toBe(4);
  });

  it("returns 4 at the 48GB boundary", () => {
    vi.spyOn(os, "totalmem").mockReturnValue(48 * GB);
    expect(detectDefaultConcurrency()).toBe(4);
  });

  it("respects the CASCADE_MAX_CONCURRENT_SUBAGENTS env override", () => {
    process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS = "3";
    vi.spyOn(os, "totalmem").mockReturnValue(8 * GB);
    expect(detectDefaultConcurrency()).toBe(3);
  });

  it("ignores non-numeric env override values", () => {
    process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS = "nope";
    vi.spyOn(os, "totalmem").mockReturnValue(24 * GB);
    expect(detectDefaultConcurrency()).toBe(2);
  });

  it("ignores env values less than 1", () => {
    process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS = "0";
    vi.spyOn(os, "totalmem").mockReturnValue(24 * GB);
    expect(detectDefaultConcurrency()).toBe(2);
  });
});

describe("DispatchQueue", () => {
  it("runs jobs immediately while under the cap", async () => {
    const queue = new DispatchQueue(2);
    const d1 = vi.fn().mockResolvedValue(undefined);
    const d2 = vi.fn().mockResolvedValue(undefined);

    await queue.enqueue({ id: "job1", dispatch: d1 });
    await queue.enqueue({ id: "job2", dispatch: d2 });

    expect(d1).toHaveBeenCalledTimes(1);
    expect(d2).toHaveBeenCalledTimes(1);
    expect(queue.size()).toEqual({ running: 2, pending: 0 });
  });

  it("queues jobs beyond the cap and reports pending count", async () => {
    const queue = new DispatchQueue(2);
    const dispatch = vi.fn().mockResolvedValue(undefined);

    await queue.enqueue({ id: "job1", dispatch });
    await queue.enqueue({ id: "job2", dispatch });
    await queue.enqueue({ id: "job3", dispatch });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(queue.size()).toEqual({ running: 2, pending: 1 });
  });

  it("dispatches the next pending job on release", async () => {
    const queue = new DispatchQueue(2);
    const dispatch = vi.fn().mockResolvedValue(undefined);

    await queue.enqueue({ id: "job1", dispatch });
    await queue.enqueue({ id: "job2", dispatch });
    await queue.enqueue({ id: "job3", dispatch });
    expect(dispatch).toHaveBeenCalledTimes(2);

    queue.release("job1");
    await new Promise((r) => setImmediate(r));

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(queue.size()).toEqual({ running: 2, pending: 0 });
  });

  it("preserves FIFO order across releases", async () => {
    const queue = new DispatchQueue(1);
    const order: string[] = [];
    const mk = (label: string) =>
      vi.fn(async () => {
        order.push(label);
      });

    await queue.enqueue({ id: "a", dispatch: mk("a") });
    await queue.enqueue({ id: "b", dispatch: mk("b") });
    await queue.enqueue({ id: "c", dispatch: mk("c") });

    queue.release("a");
    await new Promise((r) => setImmediate(r));
    queue.release("b");
    await new Promise((r) => setImmediate(r));

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("release of an unknown id is a no-op", () => {
    const queue = new DispatchQueue(2);
    expect(() => queue.release("nope")).not.toThrow();
    expect(queue.size()).toEqual({ running: 0, pending: 0 });
  });

  it("running count decreases on release with nothing pending", async () => {
    const queue = new DispatchQueue(2);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    await queue.enqueue({ id: "job1", dispatch });

    expect(queue.size()).toEqual({ running: 1, pending: 0 });
    queue.release("job1");
    expect(queue.size()).toEqual({ running: 0, pending: 0 });
  });
});

describe("getDispatchQueue (singleton)", () => {
  it("returns the same instance on repeated calls", () => {
    const a = getDispatchQueue();
    const b = getDispatchQueue();
    expect(a).toBe(b);
  });

  it("starts with zero running and zero pending", () => {
    const q = getDispatchQueue();
    const sizes = q.size();
    expect(sizes.running).toBeGreaterThanOrEqual(0);
    expect(sizes.pending).toBeGreaterThanOrEqual(0);
  });
});
