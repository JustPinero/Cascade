/**
 * Phase 38 [P2] — route tests for the fleet status endpoint.
 *
 * Same @/lib/db proxy-injection boilerplate as the webhook route tests
 * (see fireWebhook JSDoc in tests/harness/dispatch-rig.ts) — the rig
 * binds the production queue singleton, and we populate
 * globalThis.__rigPrisma around the handler call.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("@/lib/db", () => {
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      const inj = (globalThis as Record<string, unknown>).__rigPrisma;
      if (!inj) {
        throw new Error("rig prisma not injected — set __rigPrisma in the test");
      }
      return (inj as Record<string, unknown>)[prop as string];
    },
  });
  return { prisma: proxy };
});

import { GET } from "./route";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  delete (globalThis as Record<string, unknown>).__rigPrisma;
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

interface StatusBody {
  queue: { running: number; pending: number; capacity: number };
  dispatches: { queued: number; started: number; overdue: number };
}

async function callRoute(): Promise<StatusBody> {
  (globalThis as Record<string, unknown>).__rigPrisma = rig!.prisma;
  const res = await GET();
  expect(res.status).toBe(200);
  return (await res.json()) as StatusBody;
}

describe("GET /api/dispatch/status", () => {
  it("returns all zeros plus capacity on an empty system", async () => {
    rig = await createDispatchRig({ concurrency: 2, fakeTimers: false });

    const body = await callRoute();
    expect(body.queue).toEqual({ running: 0, pending: 0, capacity: 2 });
    expect(body.dispatches).toEqual({ queued: 0, started: 0, overdue: 0 });
  });

  it("reports live queue slots from the singleton", async () => {
    rig = await createDispatchRig({ concurrency: 2, fakeTimers: false });

    // Occupy one slot (never released) and park one job pending by
    // filling the second slot too, then adding a third.
    await rig.queue.enqueue({ id: "k1", dispatch: async () => undefined });
    await rig.queue.enqueue({ id: "k2", dispatch: async () => undefined });
    await rig.queue.enqueue({ id: "k3", dispatch: async () => undefined });

    const body = await callRoute();
    expect(body.queue).toEqual({ running: 2, pending: 1, capacity: 2 });
  });

  it("counts queued, started, and overdue dispatch rows", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "alpha", path: "/p/alpha" });

    const future = new Date(Date.now() + 30 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 1000);

    await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "queued",
        expectedBy: future,
      },
    });
    await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "started",
        startedAt: new Date(),
        expectedBy: future,
      },
    });
    // Overdue: started, past its deadline, not yet flipped by the watchdog.
    await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "audit",
        status: "started",
        startedAt: new Date(),
        expectedBy: past,
      },
    });
    // Terminal rows are not counted anywhere.
    await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "audit",
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        expectedBy: past,
      },
    });

    const body = await callRoute();
    expect(body.dispatches).toEqual({ queued: 1, started: 2, overdue: 1 });
  });
});
