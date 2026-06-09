import { describe, it, expect, vi, afterEach } from "vitest";
import { getDeploymentStatus, clearDeployCache } from "./deploy-monitor";

afterEach(() => {
  clearDeployCache();
  vi.restoreAllMocks();
});

describe("deploy-monitor", () => {
  it("returns unknown when no token is set", async () => {
    const originalEnv = process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_TOKEN;

    const status = await getDeploymentStatus("vercel", "proj-123");
    expect(status.platform).toBe("vercel");
    expect(status.state).toBe("unknown");

    process.env.VERCEL_TOKEN = originalEnv;
  });

  it("caches results within TTL", async () => {
    const originalEnv = process.env.VERCEL_TOKEN;
    process.env.VERCEL_TOKEN = "test-token";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          deployments: [{ state: "READY", url: "test.vercel.app" }],
        }),
    } as Response);

    // First call
    const status1 = await getDeploymentStatus("vercel", "proj-cache");
    expect(status1.state).toBe("deployed");

    // Second call should use cache
    const status2 = await getDeploymentStatus("vercel", "proj-cache");
    expect(status2.state).toBe("deployed");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    process.env.VERCEL_TOKEN = originalEnv;
  });

  it("handles fetch errors gracefully", async () => {
    const originalEnv = process.env.VERCEL_TOKEN;
    process.env.VERCEL_TOKEN = "test-token";

    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network error")
    );

    const status = await getDeploymentStatus("vercel", "proj-error");
    expect(status.state).toBe("unknown");

    process.env.VERCEL_TOKEN = originalEnv;
  });

  it("returns railway unknown when no token", async () => {
    const originalEnv = process.env.RAILWAY_TOKEN;
    delete process.env.RAILWAY_TOKEN;

    const status = await getDeploymentStatus("railway", "proj-123");
    expect(status.platform).toBe("railway");
    expect(status.state).toBe("unknown");

    process.env.RAILWAY_TOKEN = originalEnv;
  });

  // Phase 31 — audit finding [30.D7]: Vercel/Railway fetches had no
  // AbortController. A hung remote would stall the calling route until
  // Node's default socket timeout. With a timeout in place, the fetch
  // aborts and the function falls through its catch to `state: "unknown"`.
  // Fake timers let us advance past the 10s watchdog without actually
  // sleeping.
  it("returns unknown when the Vercel fetch is aborted by the watchdog", async () => {
    vi.useFakeTimers();
    const originalEnv = process.env.VERCEL_TOKEN;
    process.env.VERCEL_TOKEN = "test-token";

    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => {
          reject(
            Object.assign(new Error("aborted"), { name: "AbortError" })
          );
        });
      });
    });

    const pending = getDeploymentStatus("vercel", "proj-hang");
    await vi.advanceTimersByTimeAsync(11_000);
    const status = await pending;
    expect(status.state).toBe("unknown");
    process.env.VERCEL_TOKEN = originalEnv;
    vi.useRealTimers();
  });

  it("returns unknown when the Railway fetch is aborted by the watchdog", async () => {
    vi.useFakeTimers();
    const originalEnv = process.env.RAILWAY_TOKEN;
    process.env.RAILWAY_TOKEN = "test-token";

    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => {
          reject(
            Object.assign(new Error("aborted"), { name: "AbortError" })
          );
        });
      });
    });

    const pending = getDeploymentStatus("railway", "proj-hang");
    await vi.advanceTimersByTimeAsync(11_000);
    const status = await pending;
    expect(status.state).toBe("unknown");
    process.env.RAILWAY_TOKEN = originalEnv;
    vi.useRealTimers();
  });
});
