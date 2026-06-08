/**
 * Phase 26.2 — Windows dispatcher tests.
 *
 * Asserts the Windows code path uses `wt.exe` instead of bare bash
 * (single dispatch + multi-project flows), never touches tmux, and
 * fails loud on agent teams. The macOS-regression test uses a separate
 * import + mock reset so we don't have two platform mocks in one file.
 */
import { vi, describe, it, expect, afterEach, type Mock } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

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

// Force the Windows branch for every call in this file.
vi.mock("./platform", () => ({
  detectPlatform: () => "windows",
  getLaunchMethod: () => "wt",
}));

import {
  dispatchClaude,
  dispatchAll,
  dispatchTeam,
} from "./claude-dispatcher";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";
import { spawn, execSync } from "child_process";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

type DispatcherPrisma = Parameters<typeof dispatchAll>[0];

function spawnCallsTo(name: string): Array<{ args: readonly string[] }> {
  return (spawn as unknown as Mock).mock.calls
    .filter((c) => c[0] === name)
    .map((c) => ({ args: c[1] as readonly string[] }));
}

describe("Windows dispatcher — single project", () => {
  it("dispatchClaude spawns wt.exe with new-tab and bash -c", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({
      slug: "alpha",
      path: "/p/alpha",
    });

    const result = await dispatchClaude(
      rig.prisma as unknown as DispatcherPrisma,
      { id: project.id, slug: project.slug, path: project.path },
      "do the thing",
      { mode: "continue" }
    );

    expect(result.success).toBe(true);
    const wtCalls = spawnCallsTo("wt.exe");
    expect(wtCalls).toHaveLength(1);
    expect(wtCalls[0].args).toContain("new-tab");
    expect(wtCalls[0].args).toContain("bash");
    // The bash command must contain a cd to the project path.
    const bashIdx = wtCalls[0].args.indexOf("bash");
    const cmd = wtCalls[0].args[bashIdx + 2]; // bash, -c, <cmd>
    expect(cmd).toContain("/p/alpha");
    expect(cmd).toContain("claude");
  });

  it("dispatchClaude does NOT call tmux", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({
      slug: "alpha",
      path: "/p/alpha",
    });

    await dispatchClaude(
      rig.prisma as unknown as DispatcherPrisma,
      { id: project.id, slug: project.slug, path: project.path },
      "x",
      { mode: "continue" }
    );

    const tmuxCalls = (execSync as unknown as Mock).mock.calls.filter((c) =>
      String(c[0]).includes("tmux")
    );
    expect(tmuxCalls).toEqual([]);
  });

  it("dispatchClaude threads CASCADE_DISPATCH_ID into the wt command", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({
      slug: "alpha",
      path: "/p/alpha",
    });

    const result = await dispatchClaude(
      rig.prisma as unknown as DispatcherPrisma,
      { id: project.id, slug: project.slug, path: project.path },
      "x",
      { mode: "continue" }
    );

    const wtCalls = spawnCallsTo("wt.exe");
    expect(wtCalls).toHaveLength(1);
    const bashIdx = wtCalls[0].args.indexOf("bash");
    const cmd = wtCalls[0].args[bashIdx + 2];
    expect(cmd).toContain("CASCADE_DISPATCH_ID=");
    expect(cmd).toContain(result.idempotencyKey ?? "");
  });
});

describe("Windows dispatcher — multi project", () => {
  it("dispatchAll opens one wt pane per ready project and never calls tmux", async () => {
    rig = await createDispatchRig({ concurrency: 3, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    await rig.createProject({ slug: "beta", path: "/p/beta" });
    await rig.createProject({ slug: "gamma", path: "/p/gamma" });

    await dispatchAll(rig.prisma as unknown as DispatcherPrisma, "continue");

    const wtCalls = spawnCallsTo("wt.exe");
    expect(wtCalls).toHaveLength(3);

    const tmuxCalls = (execSync as unknown as Mock).mock.calls.filter((c) =>
      String(c[0]).includes("tmux")
    );
    expect(tmuxCalls).toEqual([]);
  });

  it("dispatchAll first job uses new-tab; subsequent jobs use split-pane (Phase 29)", async () => {
    rig = await createDispatchRig({ concurrency: 3, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    await rig.createProject({ slug: "beta", path: "/p/beta" });
    await rig.createProject({ slug: "gamma", path: "/p/gamma" });

    await dispatchAll(rig.prisma as unknown as DispatcherPrisma, "continue");

    const wtCalls = spawnCallsTo("wt.exe");
    expect(wtCalls).toHaveLength(3);
    expect(wtCalls[0].args).toContain("new-tab");
    expect(wtCalls[1].args).toContain("split-pane");
    expect(wtCalls[2].args).toContain("split-pane");
  });

  it("dispatchAll targets the same -w <window-name> for every pane (Phase 29)", async () => {
    rig = await createDispatchRig({ concurrency: 3, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    await rig.createProject({ slug: "beta", path: "/p/beta" });
    await rig.createProject({ slug: "gamma", path: "/p/gamma" });

    await dispatchAll(rig.prisma as unknown as DispatcherPrisma, "continue");

    const wtCalls = spawnCallsTo("wt.exe");
    const windowNames = wtCalls.map((c) => {
      const i = c.args.indexOf("-w");
      return c.args[i + 1];
    });
    expect(new Set(windowNames).size).toBe(1);
    // Window name should be a stable, identifiable batch name, not "0".
    expect(windowNames[0]).toMatch(/^cascade-/);
  });

  it("dispatchClaude (single) still uses -w 0 new-tab (Phase 26 regression guard)", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({
      slug: "alpha",
      path: "/p/alpha",
    });

    await dispatchClaude(
      rig.prisma as unknown as DispatcherPrisma,
      { id: project.id, slug: project.slug, path: project.path },
      "x",
      { mode: "continue" }
    );

    const wtCalls = spawnCallsTo("wt.exe");
    expect(wtCalls).toHaveLength(1);
    const wIdx = wtCalls[0].args.indexOf("-w");
    expect(wtCalls[0].args[wIdx + 1]).toBe("0");
    expect(wtCalls[0].args).toContain("new-tab");
  });
});

describe("Windows dispatcher — agent team", () => {
  it("dispatchTeam returns a clear error and does not spawn anything", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    await rig.createProject({ slug: "beta", path: "/p/beta" });

    const result = await dispatchTeam(
      rig.prisma as unknown as DispatcherPrisma,
      [
        { slug: "alpha", mode: "continue" },
        { slug: "beta", mode: "continue" },
      ]
    );

    expect(result.success).toBe(false);
    expect(result.error ?? "").toMatch(/windows/i);
    expect((spawn as unknown as Mock).mock.calls).toEqual([]);
  });
});
