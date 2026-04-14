import { describe, it, expect, vi } from "vitest";
import { checkDeployHealth, type DeployHealthResult } from "./deploy-health";

describe("checkDeployHealth", () => {
  it("returns healthy for 200 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await checkDeployHealth("https://example.com");
    expect(result.status).toBe("healthy");
    vi.unstubAllGlobals();
  });

  it("returns down for non-200 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await checkDeployHealth("https://example.com");
    expect(result.status).toBe("down");
    vi.unstubAllGlobals();
  });

  it("returns down on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const result = await checkDeployHealth("https://example.com");
    expect(result.status).toBe("down");
    expect(result.error).toContain("Network error");
    vi.unstubAllGlobals();
  });

  it("returns skipped when no URL provided", async () => {
    const result = await checkDeployHealth("");
    expect(result.status).toBe("skipped");
  });

  it("returns skipped for null URL", async () => {
    const result = await checkDeployHealth(null as unknown as string);
    expect(result.status).toBe("skipped");
  });

  it("includes checked URL in result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await checkDeployHealth("https://myapp.vercel.app");
    expect(result.url).toBe("https://myapp.vercel.app");
    vi.unstubAllGlobals();
  });
});
