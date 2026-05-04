/**
 * Phase 23.1 — rewritten on the dispatch rig.
 *
 * Same observable assertions as the original mock-based file:
 * each multi-project dispatch entry point (dispatchAll / dispatchBatch
 * / dispatchTeam) enqueues the expected number of jobs to the singleton
 * queue with the expected ids. The implementation underneath now uses
 * a real Prisma against a scratch SQLite plus the rig's standard
 * mocking surface, instead of hand-rolled module mocks.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

// child_process must be mocked at module top so the dispatcher's
// spawn / execSync / execFileSync calls don't hit the OS. The rig's
// schema push uses vi.importActual to bypass this for prisma db push.
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

// fs/promises.access is used by checkDispatchReadiness to detect
// package.json / Cargo.toml / pyproject.toml. Always-resolve so test
// project paths register as ready without files on disk.
vi.mock("fs/promises", () => {
  const api = {
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
    readdir: vi.fn(async () => []),
    rm: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { default: api, ...api };
});

vi.mock("./file-utils", () => ({
  readIfExists: vi.fn(async () => "content"),
}));

vi.mock("./validators", () => ({
  isInsideProjectsDir: vi.fn(() => true),
  sanitizeForShell: vi.fn((s: string) => s),
}));

import {
  dispatchAll,
  dispatchBatch,
  dispatchTeam,
} from "./claude-dispatcher";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

type DispatcherPrisma = Parameters<typeof dispatchAll>[0];

describe("multi-project dispatch — queue integration", () => {
  it("dispatchAll enqueues one job per ready project and writes a Dispatch row each", async () => {
    // concurrency 3 so each project runs through to "started"; otherwise
    // slot 1 is held by alpha (no webhook fires in test) and beta/gamma
    // stay queued. Real production cap is RAM-driven; the test isn't
    // asserting concurrency limits, just that each project gets a row.
    rig = await createDispatchRig({ concurrency: 3, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    await rig.createProject({ slug: "beta", path: "/p/beta" });
    await rig.createProject({ slug: "gamma", path: "/p/gamma" });

    const spy = vi.spyOn(rig.queue, "enqueue");
    await dispatchAll(rig.prisma as unknown as DispatcherPrisma, "continue");

    expect(spy).toHaveBeenCalledTimes(3);
    const ids = spy.mock.calls.map((c) => c[0].id);
    expect(ids).toEqual(["/p/alpha", "/p/beta", "/p/gamma"]);

    // Phase 23.2 — every ready project gets its own Dispatch row.
    const dispatches = await rig.getDispatches();
    expect(dispatches).toHaveLength(3);
    expect(dispatches.map((d) => d.projectSlug).sort()).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    // Each row must carry a unique idempotencyKey.
    const keys = dispatches.map((d) => d.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
    // All rows reach `started` (queue concurrency 1 + synchronous spawnFn).
    expect(dispatches.every((d) => d.status === "started")).toBe(true);
  });

  it("dispatchBatch enqueues one job per specified item and writes a Dispatch row each", async () => {
    rig = await createDispatchRig({ concurrency: 2, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    await rig.createProject({ slug: "beta", path: "/p/beta" });

    const spy = vi.spyOn(rig.queue, "enqueue");
    await dispatchBatch(rig.prisma as unknown as DispatcherPrisma, [
      { slug: "alpha", mode: "continue" },
      { slug: "beta", mode: "audit" },
    ]);

    expect(spy).toHaveBeenCalledTimes(2);
    const ids = spy.mock.calls.map((c) => c[0].id);
    expect(ids).toEqual(["/p/alpha", "/p/beta"]);

    const dispatches = await rig.getDispatches();
    expect(dispatches).toHaveLength(2);
    // Per-project mode is preserved on each Dispatch row.
    const byMode = Object.fromEntries(
      dispatches.map((d) => [d.projectSlug, d.mode])
    );
    expect(byMode).toEqual({ alpha: "continue", beta: "audit" });
  });

  it("dispatchTeam enqueues exactly one lead-agent job and writes a lead Dispatch row", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    await rig.createProject({ slug: "beta", path: "/p/beta" });
    await rig.createProject({ slug: "gamma", path: "/p/gamma" });

    const spy = vi.spyOn(rig.queue, "enqueue");
    const result = await dispatchTeam(rig.prisma as unknown as DispatcherPrisma, [
      { slug: "alpha", mode: "continue" },
      { slug: "beta", mode: "continue" },
      { slug: "gamma", mode: "continue" },
    ]);

    expect(spy).toHaveBeenCalledTimes(1);

    // Phase 23 follow-up P0.2 v1 — exactly one lead Dispatch row,
    // anchored to the first project in the batch.
    expect(result.success).toBe(true);
    expect(result.idempotencyKey).toBeTruthy();
    const dispatches = await rig.getDispatches();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].projectSlug).toBe("alpha");
    expect(dispatches[0].mode).toBe("custom");
    expect(dispatches[0].idempotencyKey).toBe(result.idempotencyKey);
  });
});
