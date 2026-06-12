/**
 * Phase 33 / audit finding [30.D2] — smoke-level route tests for the
 * Stop-hook webhook. Focus: HTTP boundary signal, not full integration
 * coverage. The deeper Dispatch lifecycle paths are covered by the
 * scenarios in tests/scenarios/webhook-*.test.ts.
 *
 * Scope:
 *   1. 400 when body is missing projectPath.
 *   2. 400 when body is not valid JSON (500-class internal error path).
 *   3. Project-not-found sad path: route returns 200 (by design — Stop
 *      hooks must not retry) and writes an orphaned-webhook event.
 *   4. Happy path with idempotencyKey: Dispatch completes + outcome +
 *      session-complete activity event written.
 *   5. Idempotency: second call with same idempotencyKey is a no-op.
 *   6. Legacy fallback: no idempotencyKey supplied → does not 500.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

// Boilerplate prisma injection for the route handler — see fireWebhook
// JSDoc in tests/harness/dispatch-rig.ts.
vi.mock("@/lib/db", () => {
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      const inj = (globalThis as Record<string, unknown>).__rigPrisma;
      if (!inj) {
        throw new Error(
          "rig prisma not injected — call rig.fireWebhook(...) inside a test"
        );
      }
      return (inj as Record<string, unknown>)[prop as string];
    },
  });
  return { prisma: proxy };
});

// Keep the webhook off the real filesystem / scanner / feature audit;
// this is a route-boundary smoke test, not full integration.
vi.mock("@/lib/project-import", () => ({
  importSingleProject: vi.fn(async (_p: unknown, projectPath: string) => ({
    slug: projectPath.split("/").pop() ?? "test",
    name: projectPath.split("/").pop() ?? "test",
    action: "scanned",
  })),
}));

vi.mock("@/lib/anthropic-feature-check", () => ({
  auditProjectFeatureUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/session-reader", () => ({
  getSessionLogs: vi.fn(async () => []),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

function buildRequest(body: unknown, opts?: { rawBody?: string }): NextRequest {
  return new NextRequest(
    "http://localhost/api/webhook/session-complete",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: opts?.rawBody ?? JSON.stringify(body),
    }
  );
}

describe("POST /api/webhook/session-complete — validation", () => {
  it("returns 400 when projectPath is missing from the body", async () => {
    // No rig needed — the validation branch returns before any prisma
    // call. The @/lib/db proxy only throws on actual property access.
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/projectPath/);
  });

  it("returns 400 when projectPath is not a string", async () => {
    const res = await POST(buildRequest({ projectPath: 42 }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/projectPath/);
  });

  it("returns 500 when the body is not valid JSON", async () => {
    // The try/catch around `request.json()` lands in the generic 500
    // handler — there's no dedicated 400-for-malformed-JSON branch.
    const res = await POST(buildRequest(null, { rawBody: "{not json" }));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/webhook/session-complete — sad paths", () => {
  it("logs an orphaned-webhook event when the project is not found", async () => {
    // Route returns 200 by design — Stop hooks must not retry. The
    // sad-path signal is an orphaned-webhook activity event.
    rig = await createDispatchRig({ fakeTimers: false });
    const result = await rig.fireWebhook({
      projectPath: "/p/never-imported",
    });
    expect(result.status).toBe(200);

    const events = await rig.prisma.activityEvent.findMany();
    const orphaned = events.find((e) => e.eventType === "orphaned-webhook");
    expect(orphaned).toBeDefined();
    expect(orphaned?.summary).toContain("never-imported");
  });
});

describe("POST /api/webhook/session-complete — happy + idempotency", () => {
  it("idempotencyKey path completes Dispatch, writes outcome + activity event", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "alpha",
      path: "/p/alpha",
    });
    const dispatch = await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "started",
        healthAtDispatch: "healthy",
        startedAt: new Date(),
      },
    });

    const result = await rig.fireWebhook({
      projectPath: "/p/alpha",
      idempotencyKey: dispatch.idempotencyKey,
    });

    expect(result.status).toBe(200);

    const dispatches = await rig.getDispatches("alpha");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].status).toBe("completed");

    const outcomes = await rig.getDispatchOutcomes("alpha");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].dispatchId).toBe(dispatch.id);

    const events = await rig.getActivityEvents({ slug: "alpha" });
    const sessionComplete = events.find(
      (e) => e.eventType === "session-complete"
    );
    expect(sessionComplete).toBeDefined();
  });

  it("a second call with the same idempotencyKey is a no-op (no duplicate outcomes/events)", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "beta",
      path: "/p/beta",
    });
    const dispatch = await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "started",
        healthAtDispatch: "healthy",
        startedAt: new Date(),
      },
    });

    const first = await rig.fireWebhook({
      projectPath: "/p/beta",
      idempotencyKey: dispatch.idempotencyKey,
    });
    expect(first.status).toBe(200);

    const second = await rig.fireWebhook({
      projectPath: "/p/beta",
      idempotencyKey: dispatch.idempotencyKey,
    });
    expect(second.status).toBe(200);
    expect((second.body as { deduped?: boolean }).deduped).toBe(true);

    // No duplicate outcomes from the deduped second call.
    const outcomes = await rig.getDispatchOutcomes("beta");
    expect(outcomes).toHaveLength(1);

    // No duplicate session-complete events either.
    const events = await rig.getActivityEvents({
      slug: "beta",
      type: "session-complete",
    });
    expect(events).toHaveLength(1);
  });

  // Phase 37 [36.A1] — slots are keyed by idempotencyKey; the release
  // must use the matched row's key, not the raw projectPath string.
  it("releases the queue slot by the matched row's idempotencyKey", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "zeta",
      path: "/p/zeta",
    });
    const dispatch = await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "started",
        startedAt: new Date(),
      },
    });
    const releaseSpy = vi.spyOn(rig.queue, "release");

    await rig.fireWebhook({
      projectPath: "/p/zeta",
      idempotencyKey: dispatch.idempotencyKey,
    });

    expect(releaseSpy).toHaveBeenCalledWith(dispatch.idempotencyKey);
  });
});

describe("POST /api/webhook/session-complete — legacy fallback", () => {
  it("returns 200 when no idempotencyKey is supplied (legacy lookup path)", async () => {
    // Smoke check: verify the no-key branch doesn't 500. The deeper
    // outcome-write behavior is covered by webhook-idempotency-key-path
    // scenarios.
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "gamma",
      path: "/p/gamma",
    });
    // Seed a session-launched event so the legacy lookup has something
    // to find — exercises the legacy outcome-write branch.
    await rig.prisma.activityEvent.create({
      data: {
        projectId: project.id,
        eventType: "session-launched",
        summary: "Dispatched: continue mode",
        details: JSON.stringify({ mode: "continue" }),
      },
    });

    const result = await rig.fireWebhook({
      projectPath: "/p/gamma",
    });

    expect(result.status).toBe(200);
    // Body shape sanity — no idempotencyKey echo when none supplied.
    expect((result.body as { idempotencyKey?: string }).idempotencyKey).toBeUndefined();
  });

  // Phase 37 [36.A1] — a key-less hook (stale .claude/settings.json)
  // must still free the slot its dispatch is holding, or the fleet
  // wedges until the watchdog deadline.
  it("releases the newest in-flight row's key when no idempotencyKey is supplied", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "eta",
      path: "/p/eta",
    });
    const dispatch = await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "started",
        startedAt: new Date(),
      },
    });
    const releaseSpy = vi.spyOn(rig.queue, "release");

    await rig.fireWebhook({ projectPath: "/p/eta" });

    expect(releaseSpy).toHaveBeenCalledWith(dispatch.idempotencyKey);
  });
});
