import { describe, it, expect, afterEach } from "vitest";
import {
  checkRateLimit,
  clearRateLimits,
  __rateLimiterStoreSizeForTests,
} from "./rate-limiter";

afterEach(() => {
  clearRateLimits();
});

describe("rate-limiter", () => {
  it("allows requests under the limit", () => {
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit("test-key", 5, 60_000);
      expect(result).toBeNull();
    }
  });

  it("blocks requests over the limit", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("block-key", 5, 60_000);
    }
    const blocked = checkRateLimit("block-key", 5, 60_000);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
  });

  it("uses separate keys for different endpoints", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("endpoint-a", 5, 60_000);
    }
    // Different key should not be blocked
    const result = checkRateLimit("endpoint-b", 5, 60_000);
    expect(result).toBeNull();
  });

  it("resets after window expires", async () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit("expire-key", 3, 50); // 50ms window
    }

    // Should be blocked now
    const blocked = checkRateLimit("expire-key", 3, 50);
    expect(blocked).not.toBeNull();

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    // Should be allowed again
    const allowed = checkRateLimit("expire-key", 3, 50);
    expect(allowed).toBeNull();
  });

  // Phase 31 — audit finding [30.D5]: the store was an unbounded Map.
  // Under a long-running dev session with rotating unique keys (per-IP,
  // per-route prefix), expired entries accumulated forever. A sweep
  // should drop them as new requests arrive.
  it("sweeps expired entries during use (bounded memory)", async () => {
    // Insert many short-window keys.
    for (let i = 0; i < 200; i++) {
      checkRateLimit(`burst-${i}`, 10, 25);
    }
    expect(__rateLimiterStoreSizeForTests()).toBeGreaterThanOrEqual(200);

    // Let them all expire.
    await new Promise((r) => setTimeout(r, 40));

    // A wave of new traffic should reclaim the expired slots, not
    // simply add to them. Exact count depends on sweep cadence; the
    // invariant is "doesn't grow without bound past the live set."
    for (let i = 0; i < 200; i++) {
      checkRateLimit(`burst2-${i}`, 10, 25);
    }
    // Allow the sweep at most one window worth of live entries +
    // a small slack for entries inserted just before sweep fired.
    expect(__rateLimiterStoreSizeForTests()).toBeLessThan(300);
  });
});
