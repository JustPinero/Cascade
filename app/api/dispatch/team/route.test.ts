import { vi, describe, it, expect, afterEach } from "vitest";

// Mock claude-dispatcher so we control dispatchTeam without touching tmux,
// the filesystem, or spawning real Claude processes.
vi.mock("@/lib/claude-dispatcher", async () => {
  const actual = await vi.importActual<typeof import("@/lib/claude-dispatcher")>(
    "@/lib/claude-dispatcher"
  );
  return {
    ...actual,
    dispatchTeam: vi.fn(),
  };
});

// The route imports `prisma` from "@/lib/db" but only forwards it to
// dispatchTeam, which is mocked. An empty object is sufficient.
vi.mock("@/lib/db", () => ({
  prisma: {},
}));

import { POST } from "./route";
import { dispatchTeam } from "@/lib/claude-dispatcher";
import { clearRateLimits } from "@/lib/rate-limiter";
import { NextRequest } from "next/server";

const mocked = vi.mocked(dispatchTeam);

afterEach(() => {
  clearRateLimits();
  vi.clearAllMocks();
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/dispatch/team", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/dispatch/team", () => {
  it("returns 400 when items is missing, not an array, or empty", async () => {
    mocked.mockResolvedValue({ success: true, error: null });

    const missing = await POST(makeRequest({}));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/items array is required/);

    const notArray = await POST(makeRequest({ items: "nope" }));
    expect(notArray.status).toBe(400);

    const empty = await POST(makeRequest({ items: [] }));
    expect(empty.status).toBe(400);

    // None of the validation failures should reach the dispatcher.
    expect(mocked).not.toHaveBeenCalled();
  });

  it("returns 400 when no items have valid (slug, mode) pairs", async () => {
    mocked.mockResolvedValue({ success: true, error: null });

    const res = await POST(
      makeRequest({
        items: [
          { slug: "", mode: "continue" }, // missing slug
          { slug: "cascade" }, // missing mode
          { slug: "medipal", mode: "bogus" }, // invalid mode
        ],
      })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No valid dispatch items/);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("delegates validated items to dispatchTeam on happy path (200)", async () => {
    mocked.mockResolvedValue({
      success: true,
      error: null,
      idempotencyKey: "key-lead",
      dispatchId: "dispatch-lead",
    });

    const res = await POST(
      makeRequest({
        items: [
          { slug: "cascade", mode: "continue", prompt: "keep going" },
          { slug: "medipal", mode: "audit" },
        ],
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.idempotencyKey).toBe("key-lead");
    expect(body.dispatchId).toBe("dispatch-lead");

    expect(mocked).toHaveBeenCalledTimes(1);
    const [, items] = mocked.mock.calls[0];
    expect(items).toEqual([
      { slug: "cascade", mode: "continue", prompt: "keep going" },
      { slug: "medipal", mode: "audit", prompt: undefined },
    ]);
  });

  it("drops invalid modes silently and only forwards valid ones", async () => {
    mocked.mockResolvedValue({ success: true, error: null });

    const res = await POST(
      makeRequest({
        items: [
          { slug: "a", mode: "continue" },
          { slug: "b", mode: "audit" },
          { slug: "c", mode: "investigate" },
          { slug: "d", mode: "custom", prompt: "hi" },
          { slug: "e", mode: "DROP TABLE" }, // dropped
          { slug: "f", mode: "" }, // dropped
        ],
      })
    );

    expect(res.status).toBe(200);
    const [, items] = mocked.mock.calls[0];
    expect(items.map((i) => i.slug)).toEqual(["a", "b", "c", "d"]);
    expect(items.map((i) => i.mode)).toEqual([
      "continue",
      "audit",
      "investigate",
      "custom",
    ]);
  });

  it("returns 429 after exceeding the rate limit (3 per minute)", async () => {
    mocked.mockResolvedValue({ success: true, error: null });

    const body = { items: [{ slug: "cascade", mode: "continue" }] };

    for (let i = 0; i < 3; i++) {
      const ok = await POST(makeRequest(body));
      expect(ok.status).toBe(200);
    }

    const blocked = await POST(makeRequest(body));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/Too many requests/);

    // Dispatcher was only invoked for the first 3 allowed requests.
    expect(mocked).toHaveBeenCalledTimes(3);
  });

  it("surfaces dispatchTeam's Windows-error result to the client (Phase 26)", async () => {
    mocked.mockResolvedValue({
      success: false,
      error:
        "Agent teams require tmux — not supported on Windows. Use single dispatch or 'Resume All' instead.",
    });

    const res = await POST(
      makeRequest({ items: [{ slug: "cascade", mode: "continue" }] })
    );

    // The route forwards the dispatcher result as-is on 200; the failure
    // shape lives in the JSON body, not the status code.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Agent teams require tmux/);
    expect(body.error).toMatch(/Windows/);
  });

  it("returns 500 with the error message on unhandled exception", async () => {
    mocked.mockRejectedValue(new Error("boom from dispatcher"));

    const res = await POST(
      makeRequest({ items: [{ slug: "cascade", mode: "continue" }] })
    );

    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/boom from dispatcher/);
  });
});
