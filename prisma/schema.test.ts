/**
 * Phase 23.2 — schema-level tests for the new Dispatch model and the
 * DispatchOutcome.dispatchId relation. Uses a scratch SQLite via the
 * shared dispatch rig — same setup, no extra plumbing.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

describe("schema — Dispatch model", () => {
  it("accepts a queued row with all required fields", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({ slug: "alpha" });
    const created = await rig.prisma.dispatch.create({
      data: {
        idempotencyKey: "key-alpha-1",
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "queued",
        expectedBy: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("queued");
    expect(created.idempotencyKey).toBe("key-alpha-1");
  });

  it("enforces uniqueness on idempotencyKey", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({ slug: "beta" });
    await rig.prisma.dispatch.create({
      data: {
        idempotencyKey: "dup-key",
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
      },
    });
    await expect(
      rig.prisma.dispatch.create({
        data: {
          idempotencyKey: "dup-key",
          projectId: project.id,
          projectSlug: project.slug,
          mode: "audit",
        },
      })
    ).rejects.toThrow();
  });

  it("DispatchOutcome links 1:1 to a Dispatch via dispatchId", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({ slug: "gamma" });
    const dispatch = await rig.prisma.dispatch.create({
      data: {
        idempotencyKey: "key-gamma-1",
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "completed",
      },
    });
    const outcome = await rig.prisma.dispatchOutcome.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        healthAtDispatch: "healthy",
        outcome: "success",
        signals: "[]",
        dispatchedAt: new Date(),
        dispatchId: dispatch.id,
      },
    });
    expect(outcome.dispatchId).toBe(dispatch.id);

    const fetched = await rig.prisma.dispatch.findUnique({
      where: { id: dispatch.id },
      include: { outcome: true },
    });
    expect(fetched?.outcome?.id).toBe(outcome.id);
  });

  it("dispatchId on DispatchOutcome is unique (1:1 enforcement)", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({ slug: "delta" });
    const dispatch = await rig.prisma.dispatch.create({
      data: {
        idempotencyKey: "key-delta-1",
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
      },
    });
    await rig.prisma.dispatchOutcome.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        healthAtDispatch: "healthy",
        outcome: "success",
        signals: "[]",
        dispatchedAt: new Date(),
        dispatchId: dispatch.id,
      },
    });
    await expect(
      rig.prisma.dispatchOutcome.create({
        data: {
          projectId: project.id,
          projectSlug: project.slug,
          mode: "continue",
          healthAtDispatch: "healthy",
          outcome: "success",
          signals: "[]",
          dispatchedAt: new Date(),
          dispatchId: dispatch.id,
        },
      })
    ).rejects.toThrow();
  });

  it("DispatchOutcome.dispatchId is nullable for pre-23.2 backfill", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({ slug: "epsilon" });
    const outcome = await rig.prisma.dispatchOutcome.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        healthAtDispatch: "healthy",
        outcome: "success",
        signals: "[]",
        dispatchedAt: new Date(),
        // dispatchId omitted — represents a pre-migration row
      },
    });
    expect(outcome.dispatchId).toBeNull();
  });
});
