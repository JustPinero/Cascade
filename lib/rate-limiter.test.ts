import { describe, it, expect, afterEach } from "vitest";
import { checkRateLimit, clearRateLimits } from "./rate-limiter";

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
});
