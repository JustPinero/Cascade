/**
 * Phase 28 — preflight API route tests.
 *
 * The route is a thin wrapper around `checkDispatchPreflight()` so the
 * test mocks the lib function and asserts shape + 200.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/dispatch-preflight", () => ({
  checkDispatchPreflight: vi.fn(),
}));

import { GET } from "./route";
import { checkDispatchPreflight } from "@/lib/dispatch-preflight";

const mocked = vi.mocked(checkDispatchPreflight);

beforeEach(() => {
  mocked.mockReset();
});

describe("GET /api/preflight", () => {
  it("returns the preflight result with status 200", async () => {
    mocked.mockResolvedValueOnce({
      platform: "windows",
      ok: true,
      missing: [],
      tools: {
        claude: "C:\\path\\claude.cmd",
        "wt.exe": "C:\\path\\wt.exe",
        bash: "C:\\path\\bash.exe",
      },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platform).toBe("windows");
    expect(body.ok).toBe(true);
    expect(body.missing).toEqual([]);
    expect(body.tools["wt.exe"]).toContain("wt.exe");
  });

  it("surfaces missing tools through the same shape", async () => {
    mocked.mockResolvedValueOnce({
      platform: "windows",
      ok: false,
      missing: ["wt.exe"],
      tools: {
        claude: "C:\\path\\claude.cmd",
        "wt.exe": null,
        bash: "C:\\path\\bash.exe",
      },
    });

    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.missing).toEqual(["wt.exe"]);
    expect(body.tools["wt.exe"]).toBeNull();
  });
});
