/**
 * Phase 23.2 — Watchdog tests. Time-sensitive logic, run with the
 * rig's fake timers off (we drive `now` explicitly via the function's
 * 3rd argument so tests are deterministic without mocking Date).
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import { runDispatchWatchdog } from "./dispatch-watchdog";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

describe("runDispatchWatchdog", () => {
  it("flips queued rows past expectedBy to timeout", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "alpha",
      path: "/p/alpha",
    });
    const past = new Date(Date.now() - 60_000);
    await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "queued",
        expectedBy: past,
      },
    });

    const result = await runDispatchWatchdog(rig.prisma, rig.queue);
    expect(result.timedOut).toBe(1);
    const rows = await rig.getDispatches("alpha");
    expect(rows[0].status).toBe("timeout");
  });

  it("flips started rows past expectedBy to timeout", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "beta",
      path: "/p/beta",
    });
    const past = new Date(Date.now() - 60_000);
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

    const result = await runDispatchWatchdog(rig.prisma, rig.queue);
    expect(result.timedOut).toBe(1);
    const rows = await rig.getDispatches("beta");
    expect(rows[0].status).toBe("timeout");
  });

  it("leaves in-window rows alone", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "gamma",
      path: "/p/gamma",
    });
    const future = new Date(Date.now() + 30 * 60 * 1000);
    await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "queued",
        expectedBy: future,
      },
    });

    const result = await runDispatchWatchdog(rig.prisma, rig.queue);
    expect(result.timedOut).toBe(0);
    const rows = await rig.getDispatches("gamma");
    expect(rows[0].status).toBe("queued");
  });

  it("is idempotent — second run is a no-op", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "delta",
      path: "/p/delta",
    });
    const past = new Date(Date.now() - 60_000);
    await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "queued",
        expectedBy: past,
      },
    });

    const first = await runDispatchWatchdog(rig.prisma, rig.queue);
    const second = await runDispatchWatchdog(rig.prisma, rig.queue);
    expect(first.timedOut).toBe(1);
    expect(second.timedOut).toBe(0);
    const events = await rig.prisma.activityEvent.findMany({
      where: { eventType: "dispatch-timeout" },
    });
    expect(events).toHaveLength(1);
  });

  it("calls queue.release(projectPath) for each timed-out row", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({
      slug: "epsilon",
      path: "/p/epsilon",
    });
    const past = new Date(Date.now() - 60_000);
    await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: project.slug,
        mode: "continue",
        status: "started",
        startedAt: new Date(),
        expectedBy: past,
      },
    });
    const releaseSpy = vi.spyOn(rig.queue, "release");

    await runDispatchWatchdog(rig.prisma, rig.queue);

    expect(releaseSpy).toHaveBeenCalledWith("/p/epsilon");
  });
});
