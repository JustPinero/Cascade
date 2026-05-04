/**
 * Phase 23.2 — webhook completes Dispatch via idempotencyKey, links a
 * DispatchOutcome via dispatchId, and is idempotent under duplicate
 * Stop hooks.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

// Boilerplate prisma injection — see fireWebhook JSDoc in
// tests/harness/dispatch-rig.ts. The webhook route imports prisma
// from @/lib/db; this proxy resolves it from the rig at call time.
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

// Stop the webhook from invoking external scanners and feature audits.
// Test focus is the Dispatch lifecycle, not the importer.
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

import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

describe("webhook idempotency-key path", () => {
  it("completes a queued Dispatch and creates a DispatchOutcome linked via dispatchId", async () => {
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
    expect(outcomes[0].mode).toBe("continue");
    expect(outcomes[0].outcome).toBe("success");
  });

  it("a duplicate webhook on a completed Dispatch is a no-op (deduped:true)", async () => {
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

    const outcomes = await rig.getDispatchOutcomes("beta");
    expect(outcomes).toHaveLength(1);
  });

  it("falls back to legacy lookup when idempotencyKey is unknown", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "gamma",
      path: "/p/gamma",
    });
    // Seed only a session-launched activity event — no Dispatch row.
    // Simulates a pre-23.2 in-flight dispatch.
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
      idempotencyKey: "unknown-key-fallback-test",
    });

    expect(result.status).toBe(200);
    const outcomes = await rig.getDispatchOutcomes("gamma");
    expect(outcomes).toHaveLength(1);
    // Legacy fallback writes outcome without a dispatchId.
    expect(outcomes[0].dispatchId).toBeNull();
    expect(outcomes[0].mode).toBe("continue");
  });

  it("logs orphaned-webhook activity event when project does not exist", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    // No createProject — webhook arrives for an unknown slug.

    const result = await rig.fireWebhook({
      projectPath: "/p/deleted-project",
    });
    expect(result.status).toBe(200);

    // No project means we look at activity events without a slug.
    const events = await rig.prisma.activityEvent.findMany();
    const orphaned = events.find((e) => e.eventType === "orphaned-webhook");
    expect(orphaned).toBeDefined();
  });
});
