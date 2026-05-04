/**
 * Phase 23.5.1 — batch resilience scenarios.
 *
 * dispatchAll / dispatchBatch must not abort the remainder of a batch
 * when a single project's spawn fails. Each project's success/failure
 * is reported in `results` and the loop continues to the next.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

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

vi.mock("@/lib/file-utils", () => ({
  readIfExists: vi.fn(async () => "content"),
}));

vi.mock("@/lib/validators", () => ({
  isInsideProjectsDir: vi.fn(() => true),
  sanitizeForShell: vi.fn((s: string) => s),
}));

import { dispatchAll, dispatchBatch } from "@/lib/claude-dispatcher";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

/**
 * Install an execSync mock that throws on the Nth `respawn-pane`
 * invocation only. tmux session/window setup commands pass through.
 */
async function failOnRespawnPaneCall(failingCallNumber: number): Promise<void> {
  const childProcess = await import("child_process");
  const execMock = vi.mocked(childProcess.execSync);
  let respawnCalls = 0;
  execMock.mockImplementation((cmd: unknown) => {
    const cmdStr = typeof cmd === "string" ? cmd : "";
    if (cmdStr.includes("respawn-pane")) {
      respawnCalls++;
      if (respawnCalls === failingCallNumber) {
        throw new Error("tmux respawn-pane: pane gone");
      }
    }
    return Buffer.from("");
  });
}

describe("batch resilience — dispatchBatch", () => {
  it("continues the batch after a per-project spawn failure", async () => {
    rig = await createDispatchRig({ concurrency: 3, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    await rig.createProject({ slug: "beta", path: "/p/beta" });
    await rig.createProject({ slug: "gamma", path: "/p/gamma" });

    // Beta's respawn-pane (the 2nd respawn call) throws; alpha + gamma
    // succeed. Without 23.5.1's per-project try/catch, gamma would
    // never enqueue.
    await failOnRespawnPaneCall(2);

    const result = await dispatchBatch(rig.prisma, [
      { slug: "alpha", mode: "continue" },
      { slug: "beta", mode: "continue" },
      { slug: "gamma", mode: "continue" },
    ]);

    expect(result.results).toHaveLength(3);
    const byProject = Object.fromEntries(
      result.results.map((r) => [r.projectSlug, r])
    );
    expect(byProject.alpha.success).toBe(true);
    expect(byProject.beta.success).toBe(false);
    expect(byProject.beta.error).toMatch(/respawn-pane/);
    expect(byProject.gamma.success).toBe(true);

    // All three Dispatch rows exist; alpha + gamma started, beta failed.
    const rows = await rig.prisma.dispatch.findMany({
      orderBy: { enqueuedAt: "asc" },
    });
    expect(rows).toHaveLength(3);
    const rowsBySlug = Object.fromEntries(
      rows.map((r) => [r.projectSlug, r])
    );
    expect(rowsBySlug.alpha.status).toBe("started");
    expect(rowsBySlug.beta.status).toBe("failed");
    expect(rowsBySlug.gamma.status).toBe("started");
  });

  it("the launched count reflects only successful projects", async () => {
    rig = await createDispatchRig({ concurrency: 3, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    await rig.createProject({ slug: "beta", path: "/p/beta" });
    await rig.createProject({ slug: "gamma", path: "/p/gamma" });

    await failOnRespawnPaneCall(2);

    const result = await dispatchBatch(rig.prisma, [
      { slug: "alpha", mode: "continue" },
      { slug: "beta", mode: "continue" },
      { slug: "gamma", mode: "continue" },
    ]);

    expect(result.launched).toBe(2);
  });
});

describe("batch resilience — dispatchAll", () => {
  it("continues the batch after a per-project spawn failure", async () => {
    rig = await createDispatchRig({ concurrency: 3, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha", status: "building" });
    await rig.createProject({ slug: "beta", path: "/p/beta", status: "building" });
    await rig.createProject({ slug: "gamma", path: "/p/gamma", status: "building" });

    await failOnRespawnPaneCall(2);

    const result = await dispatchAll(rig.prisma, "continue");

    expect(result.results).toHaveLength(3);
    const byProject = Object.fromEntries(
      result.results.map((r) => [r.projectSlug, r])
    );
    expect(byProject.alpha.success).toBe(true);
    expect(byProject.beta.success).toBe(false);
    expect(byProject.gamma.success).toBe(true);
    expect(result.launched).toBe(2);
  });
});
