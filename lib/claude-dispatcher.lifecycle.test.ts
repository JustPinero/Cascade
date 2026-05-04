/**
 * Phase 23.2 — Dispatch lifecycle assertions on dispatchClaude.
 *
 * Covers: row written at enqueue (queued), transition to started,
 * transition to failed on spawn throw, and CASCADE_DISPATCH_ID env
 * passthrough to the spawned process.
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
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

describe("dispatchClaude — Dispatch row lifecycle", () => {
  it("writes a Dispatch row at enqueue with idempotencyKey + expectedBy", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    const before = Date.now();
    const result = await dispatchClaude(rig.prisma, project, "prompt", {
      mode: "continue",
    });
    const after = Date.now();

    const row = await rig.prisma.dispatch.findUnique({
      where: { id: result.dispatchId! },
    });
    expect(row).not.toBeNull();
    expect(row!.projectId).toBe(project.id);
    expect(row!.projectSlug).toBe("alpha");
    expect(row!.mode).toBe("continue");
    expect(row!.idempotencyKey).toBe(result.idempotencyKey);
    // expectedBy is roughly 30 minutes from enqueue.
    const expectedByMs = row!.expectedBy!.getTime();
    expect(expectedByMs).toBeGreaterThanOrEqual(before + 25 * 60 * 1000);
    expect(expectedByMs).toBeLessThanOrEqual(after + 35 * 60 * 1000);
  });

  it("transitions queued → started before spawn fires", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "beta", path: "/p/beta" });
    const result = await dispatchClaude(rig.prisma, project, "prompt");

    // After enqueue resolves at concurrency=1, the dispatch ran
    // synchronously through the queue. The row should be at "started"
    // (or beyond) since the spawn returned cleanly without throwing.
    const row = await rig.prisma.dispatch.findUnique({
      where: { id: result.dispatchId! },
    });
    expect(row!.status).toBe("started");
    expect(row!.startedAt).not.toBeNull();
  });

  it("transitions to failed with errorMessage when spawn throws", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "gamma", path: "/p/gamma" });
    // Make spawn throw on the next call.
    const childProcess = await import("child_process");
    vi.mocked(childProcess.spawn).mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });

    const result = await dispatchClaude(rig.prisma, project, "prompt");

    // dispatchClaude swallows the spawn throw at the outer try/catch
    // and returns an error result. The Dispatch row should be marked
    // failed with the captured error message.
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ENOENT/);

    // The Dispatch row should exist and be marked failed.
    const rows = await rig.prisma.dispatch.findMany({
      where: { projectSlug: "gamma" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].errorMessage).toMatch(/ENOENT/);
    expect(rows[0].completedAt).not.toBeNull();
  });

  it("passes CASCADE_DISPATCH_ID into the spawned process env on Linux", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "delta", path: "/p/delta" });
    const result = await dispatchClaude(rig.prisma, project, "prompt");

    expect(rig.spawnRecords.length).toBeGreaterThan(0);
    // launchInTerminal on macOS uses osascript and threads env via cmd
    // string prefix, not via spawn opts. On Linux it uses bash -c with
    // env in spawn opts. Test against whichever path actually ran:
    // either spawn opts.env contains the key, OR the cmd string the
    // spawn ran contains the key as a leading export.
    const found = rig.spawnRecords.some((rec) => {
      const fromOpts =
        (rec.opts as { env?: Record<string, string> })?.env?.CASCADE_DISPATCH_ID;
      const fromArgs = rec.args.some((a) =>
        typeof a === "string" && a.includes("CASCADE_DISPATCH_ID=")
      );
      return fromOpts === result.idempotencyKey || fromArgs;
    });
    expect(found).toBe(true);
  });
});
