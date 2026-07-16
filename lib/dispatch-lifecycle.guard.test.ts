/**
 * Phase 42 (P0.2a) — guarded queued→started transition.
 *
 * The dispatch closure used to flip rows to `started` unconditionally.
 * A row the watchdog had already flipped to `timeout` while it waited
 * for a slot (expectedBy was anchored at ENQUEUE time) would be
 * resurrected by drain and spawned anyway — a session Cascade had
 * declared dead going live, holding a phantom slot. The closure must
 * (a) only start rows still `queued`, releasing the slot otherwise, and
 * (b) re-anchor expectedBy at actual start so queue wait time never
 * eats the run window.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";
import { enqueueWithDispatchRow } from "./dispatch-lifecycle";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
});

const EXPECTED_BY_MS = 30 * 60 * 1000;

describe("enqueueWithDispatchRow — guarded start transition", () => {
  it("does not spawn timed-out/failed rows when drain reaches them", async () => {
    rig = await createDispatchRig({ concurrency: 1 });
    const project = await rig.createProject({ slug: "alpha", path: "/p/alpha" });

    const spawnA = vi.fn();
    const { idempotencyKey: keyA } = await enqueueWithDispatchRow(rig.prisma, {
      project: { id: Number(project.id), slug: "alpha", path: "/p/alpha" },
      mode: "continue",
      spawnFn: spawnA,
    });
    expect(spawnA).toHaveBeenCalledTimes(1);

    // B waits in pending (cap 1, A's slot is held until webhook release)
    const spawnB = vi.fn();
    const { dispatchId: idB } = await enqueueWithDispatchRow(rig.prisma, {
      project: { id: Number(project.id), slug: "alpha", path: "/p/alpha" },
      mode: "continue",
      spawnFn: spawnB,
    });
    expect(spawnB).not.toHaveBeenCalled();

    // Watchdog declares pending B dead while it waits
    await rig.prisma.dispatch.update({
      where: { id: idB },
      data: { status: "timeout", completedAt: new Date() },
    });

    // Webhook completes A → slot frees → drain reaches B
    rig.queue.release(keyA);
    await vi.waitFor(async () => {
      const row = await rig!.prisma.dispatch.findUnique({ where: { id: idB } });
      expect(row?.status).toBe("timeout"); // NOT resurrected to started
    });
    expect(spawnB).not.toHaveBeenCalled();
    // B's slot was released immediately — nothing running or pending
    expect(rig.queue.size()).toEqual({ running: 0, pending: 0 });
  });

  it("re-anchors expectedBy at actual start, not enqueue", async () => {
    rig = await createDispatchRig({ concurrency: 1 });
    const project = await rig.createProject({ slug: "beta", path: "/p/beta" });

    const { idempotencyKey: keyA } = await enqueueWithDispatchRow(rig.prisma, {
      project: { id: Number(project.id), slug: "beta", path: "/p/beta" },
      mode: "continue",
      spawnFn: () => {},
    });

    const { dispatchId: idB } = await enqueueWithDispatchRow(rig.prisma, {
      project: { id: Number(project.id), slug: "beta", path: "/p/beta" },
      mode: "continue",
      spawnFn: () => {},
    });

    // B waits 10 minutes in the pending queue
    await rig.advanceTime(10 * 60 * 1000);
    rig.queue.release(keyA);

    await vi.waitFor(async () => {
      const row = await rig!.prisma.dispatch.findUnique({ where: { id: idB } });
      expect(row?.status).toBe("started");
    });

    const row = await rig.prisma.dispatch.findUnique({ where: { id: idB } });
    expect(row?.startedAt).toBeTruthy();
    expect(row?.expectedBy).toBeTruthy();
    // Full 30-minute window from START; enqueue-anchoring would leave ~20m
    const windowMs =
      row!.expectedBy!.getTime() - row!.startedAt!.getTime();
    expect(windowMs).toBe(EXPECTED_BY_MS);
  });
});
