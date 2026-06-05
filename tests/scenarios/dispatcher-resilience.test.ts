/**
 * Phase 23.5 — dispatcher resilience scenarios.
 *
 * Failure modes the queue + Dispatch lifecycle must absorb without
 * leaking slots or losing rows: spawn throws on first job, tmux
 * respawn-pane fails for one project in a batch, two parallel
 * dispatches collide on the same project, custom prompts contain
 * shell metacharacters.
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

// Phase 26 — tmux-grid resilience scenarios. Pin the tested platform
// to linux so the tmux path runs (Windows would skip respawn-pane
// entirely and the simulated tmux failure would never fire).
vi.mock("@/lib/platform", () => ({
  detectPlatform: () => "linux",
  getLaunchMethod: () => "tmux-direct",
}));

import { dispatchClaude, dispatchBatch } from "@/lib/claude-dispatcher";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

describe("dispatcher resilience", () => {
  it("a dispatch that throws marks Dispatch as failed and frees the slot for the next job", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "alpha", path: "/p/alpha" });

    const childProcess = await import("child_process");
    const spawnMock = vi.mocked(childProcess.spawn);
    // First spawn throws (simulates ENOENT); second succeeds.
    spawnMock.mockImplementationOnce(() => {
      throw new Error("ENOENT: claude binary not found");
    });

    const first = await dispatchClaude(rig.prisma, project, "prompt one");
    expect(first.success).toBe(false);
    expect(first.error).toMatch(/ENOENT/);

    // The first Dispatch row should be marked failed and its slot
    // released (queue.enqueue drains the failure path).
    const failedRow = await rig.prisma.dispatch.findFirst({
      where: { projectSlug: "alpha" },
    });
    expect(failedRow?.status).toBe("failed");

    // Second dispatch must reach started — proves the slot freed.
    const second = await dispatchClaude(rig.prisma, project, "prompt two");
    expect(second.success).toBe(true);
    const rows = await rig.prisma.dispatch.findMany({
      where: { projectSlug: "alpha" },
      orderBy: { enqueuedAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("failed");
    expect(rows[1].status).toBe("started");
  });

  it("respawn-pane failure for one project doesn't stop the rest of the batch", async () => {
    // 2 projects; dispatchBatch builds tmux pane grid via execSync,
    // then for each project respawn-pane via execSync. Inject a
    // failure for project beta's respawn only.
    rig = await createDispatchRig({ concurrency: 2, fakeTimers: false });
    await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    await rig.createProject({ slug: "beta", path: "/p/beta" });

    const childProcess = await import("child_process");
    const execMock = vi.mocked(childProcess.execSync);
    let respawnCalls = 0;
    execMock.mockImplementation((cmd: unknown) => {
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("respawn-pane")) {
        respawnCalls++;
        // Fail the second respawn (project beta).
        if (respawnCalls === 2) {
          throw new Error("tmux respawn-pane: pane gone");
        }
      }
      return Buffer.from("");
    });

    // Phase 23.5.1 — dispatchBatch now catches per-project failures
    // and continues the loop. The result includes a per-project
    // success/failure breakdown; the throw never bubbles to caller.
    const result = await dispatchBatch(rig.prisma, [
      { slug: "alpha", mode: "continue" },
      { slug: "beta", mode: "continue" },
    ]);

    expect(result.results).toHaveLength(2);
    const byResult = Object.fromEntries(
      result.results.map((r) => [r.projectSlug, r])
    );
    expect(byResult.alpha.success).toBe(true);
    expect(byResult.beta.success).toBe(false);
    expect(byResult.beta.error).toMatch(/respawn-pane/);

    const rows = await rig.prisma.dispatch.findMany({
      orderBy: { enqueuedAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    const byProject = Object.fromEntries(
      rows.map((r) => [r.projectSlug, r])
    );
    expect(byProject.alpha.status).toBe("started");
    expect(byProject.beta.status).toBe("failed");
    expect(byProject.beta.errorMessage).toMatch(/respawn-pane/);
  });

  it("two concurrent dispatches for the same project produce distinct Dispatch rows with unique idempotencyKeys", async () => {
    rig = await createDispatchRig({ concurrency: 2, fakeTimers: false });
    const project = await rig.createProject({ slug: "alpha", path: "/p/alpha" });

    const [a, b] = await Promise.all([
      dispatchClaude(rig.prisma, project, "first"),
      dispatchClaude(rig.prisma, project, "second"),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(a.dispatchId).not.toBe(b.dispatchId);

    const rows = await rig.getDispatches("alpha");
    expect(rows).toHaveLength(2);
    const keys = rows.map((r) => r.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("custom prompt with shell metacharacters round-trips without breaking the spawn", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "alpha", path: "/p/alpha" });

    const customPrompt = `Test with "double quotes" and 'single quotes' and $env_var and \`backticks\` and \\backslashes and ; semicolons | pipes && newlines`;

    const result = await dispatchClaude(
      rig.prisma,
      project,
      "ignored",
      { customPrompt }
    );

    expect(result.success).toBe(true);
    // Dispatch row records the original prompt (or has no error).
    const row = await rig.prisma.dispatch.findUnique({
      where: { id: result.dispatchId! },
    });
    expect(row?.status).toBe("started");
    expect(row?.errorMessage).toBeNull();
    // Spawn was called and recorded; no throw means escape held.
    expect(rig.spawnRecords.length).toBeGreaterThan(0);
  });
});
