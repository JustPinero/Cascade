/**
 * Phase 33 / [30.D2] — Direct unit tests for enqueueWithDispatchRow.
 *
 * The lifecycle helper has been covered only indirectly through
 * dispatcher entry-point tests. These tests exercise it directly so
 * the queued → started → failed state machine has a focused contract.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

vi.mock("./platform", () => ({
  detectPlatform: () => "linux",
  getLaunchMethod: () => "tmux-direct",
}));

import { enqueueWithDispatchRow } from "./dispatch-lifecycle";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

describe("enqueueWithDispatchRow", () => {
  it("creates a Dispatch row at queued with all spec fields populated", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "alpha", path: "/p/alpha" });

    // Block the spawn so we can observe the queued state. With
    // concurrency=1 the queue runs the job inline inside enqueue, so
    // we hold the spawn open with a never-resolving promise and race
    // against the create() so we can inspect the queued row before
    // the started transition lands.
    let releaseSpawn!: () => void;
    const spawnGate = new Promise<void>((res) => {
      releaseSpawn = res;
    });

    const enqueuePromise = enqueueWithDispatchRow(rig.prisma, {
      project,
      mode: "continue",
      prompt: "do the thing",
      customPrompt: "custom override",
      healthAtDispatch: "yellow",
      spawnFn: async () => {
        await spawnGate;
      },
    });

    // Poll briefly for the queued row to land. The create() runs
    // before enqueue, so it's visible almost immediately.
    let row = await rig.prisma.dispatch.findFirst({
      where: { projectSlug: "alpha" },
    });
    const deadline = Date.now() + 1000;
    while (!row && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      row = await rig.prisma.dispatch.findFirst({
        where: { projectSlug: "alpha" },
      });
    }

    expect(row).not.toBeNull();
    expect(row!.projectId).toBe(project.id);
    expect(row!.projectSlug).toBe("alpha");
    expect(row!.mode).toBe("continue");
    expect(row!.prompt).toBe("do the thing");
    expect(row!.customPrompt).toBe("custom override");
    expect(row!.healthAtDispatch).toBe("yellow");
    expect(row!.idempotencyKey).toMatch(/.+/);
    expect(row!.expectedBy).not.toBeNull();

    releaseSpawn();
    const result = await enqueuePromise;
    expect(result.idempotencyKey).toBe(row!.idempotencyKey);
    expect(result.dispatchId).toBe(row!.id);
  });

  it("transitions queued → started with startedAt populated when the queue runs the job", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "beta", path: "/p/beta" });

    const result = await enqueueWithDispatchRow(rig.prisma, {
      project,
      mode: "continue",
      spawnFn: async () => {
        // no-op success
      },
    });

    const row = await rig.prisma.dispatch.findUnique({
      where: { id: result.dispatchId },
    });
    expect(row!.status).toBe("started");
    expect(row!.startedAt).not.toBeNull();
    expect(row!.errorMessage).toBeNull();
    expect(row!.completedAt).toBeNull();
  });

  it("transitions to failed and re-throws when spawnFn throws", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "gamma", path: "/p/gamma" });

    let thrown: unknown = null;
    try {
      await enqueueWithDispatchRow(rig.prisma, {
        project,
        mode: "continue",
        spawnFn: async () => {
          throw new Error("boom: spawn refused");
        },
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/boom: spawn refused/);

    const rows = await rig.prisma.dispatch.findMany({
      where: { projectSlug: "gamma" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].errorMessage).toMatch(/boom: spawn refused/);
    expect(rows[0].completedAt).not.toBeNull();
    expect(rows[0].startedAt).not.toBeNull();
  });

  it("captures non-Error throws via String() in errorMessage", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "delta", path: "/p/delta" });

    await expect(
      enqueueWithDispatchRow(rig.prisma, {
        project,
        mode: "continue",
        spawnFn: () => {
          throw "string-thrown-value";
        },
      })
    ).rejects.toBe("string-thrown-value");

    const row = await rig.prisma.dispatch.findFirst({
      where: { projectSlug: "delta" },
    });
    expect(row!.status).toBe("failed");
    expect(row!.errorMessage).toBe("string-thrown-value");
  });

  it("produces a unique idempotencyKey on each invocation", async () => {
    rig = await createDispatchRig({ concurrency: 2, fakeTimers: false });
    const project = await rig.createProject({ slug: "echo", path: "/p/echo" });

    const results = await Promise.all([
      enqueueWithDispatchRow(rig.prisma, {
        project,
        mode: "continue",
        spawnFn: async () => undefined,
      }),
      enqueueWithDispatchRow(rig.prisma, {
        project,
        mode: "continue",
        spawnFn: async () => undefined,
      }),
      enqueueWithDispatchRow(rig.prisma, {
        project,
        mode: "continue",
        spawnFn: async () => undefined,
      }),
    ]);

    const keys = results.map((r) => r.idempotencyKey);
    const ids = results.map((r) => r.dispatchId);
    expect(new Set(keys).size).toBe(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("defaults expectedBy to ~30 minutes from enqueue when expectedByMs is omitted", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "foxtrot", path: "/p/foxtrot" });

    const before = Date.now();
    const result = await enqueueWithDispatchRow(rig.prisma, {
      project,
      mode: "continue",
      spawnFn: async () => undefined,
    });
    const after = Date.now();

    const row = await rig.prisma.dispatch.findUnique({
      where: { id: result.dispatchId },
    });
    const expectedByMs = row!.expectedBy!.getTime();
    // 30-minute default, allow a wide window to absorb test jitter.
    expect(expectedByMs).toBeGreaterThanOrEqual(before + 25 * 60 * 1000);
    expect(expectedByMs).toBeLessThanOrEqual(after + 35 * 60 * 1000);
  });

  it("honors a custom expectedByMs override", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "golf", path: "/p/golf" });

    const customMs = 5 * 60 * 1000; // 5 minutes
    const before = Date.now();
    const result = await enqueueWithDispatchRow(rig.prisma, {
      project,
      mode: "continue",
      expectedByMs: customMs,
      spawnFn: async () => undefined,
    });
    const after = Date.now();

    const row = await rig.prisma.dispatch.findUnique({
      where: { id: result.dispatchId },
    });
    const expectedByMs = row!.expectedBy!.getTime();
    expect(expectedByMs).toBeGreaterThanOrEqual(before + customMs - 1000);
    expect(expectedByMs).toBeLessThanOrEqual(after + customMs + 1000);
    // And nowhere near the 30-minute default.
    expect(expectedByMs).toBeLessThan(before + 20 * 60 * 1000);
  });
});
