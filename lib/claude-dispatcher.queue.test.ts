/**
 * Phase 23.2 — rewritten on the dispatch rig.
 *
 * dispatchClaude takes a prisma client + project context now and
 * routes through enqueueWithDispatchRow. These tests confirm the
 * basic queue contract: a row is enqueued at the projectPath id,
 * invalid paths are rejected pre-write.
 *
 * Lifecycle assertions (queued → started → failed transitions, env
 * passthrough) live in claude-dispatcher.lifecycle.test.ts.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

vi.mock("fs", () => ({
  default: {
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => ""),
  },
}));

vi.mock("./validators", () => ({
  isInsideProjectsDir: vi.fn(() => true),
  sanitizeForShell: vi.fn((s: string) => s),
}));

import { dispatchClaude } from "./claude-dispatcher";
import { isInsideProjectsDir } from "./validators";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

describe("dispatchClaude — queue integration", () => {
  it("routes through the singleton dispatch queue with projectPath as id", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    vi.mocked(isInsideProjectsDir).mockReturnValue(true);
    const project = await rig.createProject({
      slug: "alpha",
      path: "/some/project/path",
    });

    const spy = vi.spyOn(rig.queue, "enqueue");
    const result = await dispatchClaude(rig.prisma, project, "prompt text");

    // Diagnostic ordering: surface the dispatcher's verdict first so a
    // failed early-return is visible instead of being shadowed by the
    // queue assertion.
    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    expect(result.idempotencyKey).toBeTruthy();
    expect(result.dispatchId).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].id).toBe("/some/project/path");
  });

  it("returns failure without enqueueing when path is outside projects dir", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    vi.mocked(isInsideProjectsDir).mockReturnValueOnce(false);
    const project = await rig.createProject({
      slug: "outside",
      path: "/outside",
    });

    const spy = vi.spyOn(rig.queue, "enqueue");
    const result = await dispatchClaude(rig.prisma, project, "prompt");

    expect(spy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid project path/);
    // No Dispatch row should have been written when validation rejects.
    const dispatches = await rig.prisma.dispatch.findMany();
    expect(dispatches).toHaveLength(0);
  });
});
