/**
 * Phase 42 (P0.1) — payload-shape validation at the webhook boundary.
 * Malformed types must 400 BEFORE any prisma access (previously a
 * non-string idempotencyKey reached findUnique and produced a 500).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const proxy = new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `validation leaked: prisma.${String(prop)} touched for malformed payload`
        );
      },
    }
  );
  return { prisma: proxy };
});

import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/webhook/session-complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhook/session-complete — payload validation", () => {
  it("400 on non-string idempotencyKey", async () => {
    const res = await POST(
      makeReq({ projectPath: "/p/alpha", idempotencyKey: 42 }) as never
    );
    expect(res.status).toBe(400);
  });

  it("400 on non-string projectPath", async () => {
    const res = await POST(makeReq({ projectPath: 7 }) as never);
    expect(res.status).toBe(400);
  });

  it("400 on non-object body", async () => {
    const res = await POST(makeReq("just a string") as never);
    expect(res.status).toBe(400);
  });

  it("400 on out-of-tree projectPath (containment guard surfaced)", async () => {
    // Guard fires inside ingest before prisma is touched; the route
    // maps the rejection to a 400. PROJECTS_DIR=/p via vitest config.
    const res = await POST(makeReq({ projectPath: "/etc" }) as never);
    expect(res.status).toBe(400);
  });
});
