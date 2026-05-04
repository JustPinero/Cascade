/**
 * Phase 23.5 — webhook resilience scenarios.
 *
 * The webhook handler is on the critical path: a Stop hook firing
 * always needs to (a) complete its Dispatch row so the queue slot
 * frees, (b) return 200 so the hook process exits cleanly. Any
 * exception during downstream work (importSingleProject, escalation
 * detection, DispatchOutcome create) must be isolated.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

// Boilerplate prisma injection — see fireWebhook JSDoc.
vi.mock("@/lib/db", () => {
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      const inj = (globalThis as Record<string, unknown>).__rigPrisma;
      if (!inj) {
        throw new Error("rig prisma not injected — fireWebhook setup failed");
      }
      return (inj as Record<string, unknown>)[prop as string];
    },
  });
  return { prisma: proxy };
});

vi.mock("@/lib/anthropic-feature-check", () => ({
  auditProjectFeatureUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/session-reader", () => ({
  getSessionLogs: vi.fn(async () => []),
}));

// Default importSingleProject works; specific tests override per-call.
const importMock = vi.fn(async (_p: unknown, projectPath: string) => ({
  slug: projectPath.split("/").pop() ?? "test",
  name: projectPath.split("/").pop() ?? "test",
  action: "scanned" as const,
}));
vi.mock("@/lib/project-import", () => ({
  importSingleProject: importMock,
}));

import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  importMock.mockReset();
  importMock.mockImplementation(async (_p: unknown, projectPath: string) => ({
    slug: projectPath.split("/").pop() ?? "test",
    name: projectPath.split("/").pop() ?? "test",
    action: "scanned" as const,
  }));
});

describe("webhook resilience", () => {
  it("completes Dispatch even when importSingleProject throws", async () => {
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

    importMock.mockRejectedValueOnce(new Error("boom: import failed"));

    const result = await rig.fireWebhook({
      projectPath: "/p/alpha",
      idempotencyKey: dispatch.idempotencyKey,
    });

    expect(result.status).toBe(200);
    const dispatches = await rig.getDispatches("alpha");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].status).toBe("completed");
    // Webhook surfaces the importError in its body so callers can see the issue.
    expect((result.body as { importError?: string }).importError).toMatch(
      /boom/
    );
  });

  it("returns 200 even when DispatchOutcome.create throws", async () => {
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

    // Force the outcome insert to fail. Spying on the rig's prisma
    // hits the same instance the webhook handler uses (via the proxy).
    const originalCreate = rig.prisma.dispatchOutcome.create;
    rig.prisma.dispatchOutcome.create = vi.fn(async () => {
      throw new Error("simulated outcome failure");
    }) as unknown as typeof originalCreate;
    try {
      const result = await rig.fireWebhook({
        projectPath: "/p/beta",
        idempotencyKey: dispatch.idempotencyKey,
      });
      expect(result.status).toBe(200);
      const dispatches = await rig.getDispatches("beta");
      // Dispatch row still completes — outcome write is independent.
      expect(dispatches[0].status).toBe("completed");
    } finally {
      rig.prisma.dispatchOutcome.create = originalCreate;
    }
  });

  it("logs orphaned-webhook when slug doesn't match (project renamed)", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    // Seed project at one slug; webhook arrives for a different path
    // (matching basename → toSlug yields a different value).
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });

    const result = await rig.fireWebhook({
      projectPath: "/p/alpha-renamed",
    });

    expect(result.status).toBe(200);
    const events = await rig.prisma.activityEvent.findMany();
    const orphaned = events.find((e) => e.eventType === "orphaned-webhook");
    expect(orphaned).toBeDefined();
    expect(orphaned?.summary).toContain("alpha-renamed");
  });

  it("idempotency-key path completes Dispatch even when no session-launched activity event exists", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "gamma",
      path: "/p/gamma",
    });
    const dispatch = await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "audit",
        status: "started",
        healthAtDispatch: "healthy",
        startedAt: new Date(),
      },
    });

    // No session-launched activity event seeded — the legacy lookup
    // would fail, but the new idempotencyKey path must succeed
    // independently. Regression guard against re-introducing the
    // legacy-lookup-as-primary anti-pattern.
    const result = await rig.fireWebhook({
      projectPath: "/p/gamma",
      idempotencyKey: dispatch.idempotencyKey,
    });

    expect(result.status).toBe(200);
    const dispatches = await rig.getDispatches("gamma");
    expect(dispatches[0].status).toBe("completed");
    const outcomes = await rig.getDispatchOutcomes("gamma");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].dispatchId).toBe(dispatch.id);
  });
});
