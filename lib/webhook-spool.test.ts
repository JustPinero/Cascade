/**
 * Phase 41.5 — server-side spool drain.
 *
 * `drainWebhookSpool` reads the failure spool (written by the canonical
 * Stop-hook script when Cascade is unreachable) and replays each entry
 * through the SAME ingestion path as a live webhook POST
 * (`lib/webhook-ingest.ts#ingestSessionComplete`). The drain runs on
 * server boot and on an interval.
 *
 * Design under test:
 *   - Entries ingest via the normal path → DispatchOutcome rows recorded.
 *   - Atomic vs concurrent writes: the spool is rotated (renamed) aside
 *     before reading, so a Stop hook appending mid-drain lands in a
 *     fresh spool and is neither lost nor double-ingested.
 *   - Malformed lines are quarantined + logged, never fatal.
 *   - Idempotent: replaying the same payload twice yields one outcome
 *     (the dispatcher dedups on idempotencyKey).
 */
import { vi, describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// The drain replays through the real ingestion path; mock the same
// external boundaries the live route mocks in its own tests.
vi.mock("@/lib/anthropic-feature-check", () => ({
  auditProjectFeatureUsage: vi.fn(async () => undefined),
}));
vi.mock("@/lib/session-reader", () => ({
  getSessionLogs: vi.fn(async () => []),
}));
vi.mock("@/lib/project-import", () => ({
  importSingleProject: vi.fn(async (_p: unknown, projectPath: string) => ({
    slug: projectPath.split("/").pop() ?? "test",
    name: projectPath.split("/").pop() ?? "test",
    action: "scanned" as const,
  })),
}));

import { drainWebhookSpool } from "./webhook-spool";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;
let tmpDir: string | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
  vi.clearAllMocks();
});

function scratchSpool(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cascade-spool-"));
  return path.join(tmpDir, "webhook-spool.jsonl");
}

describe("drainWebhookSpool — ingests via the normal path", () => {
  it("records one DispatchOutcome per spooled entry, same shape as live posts", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const projA = await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    const projB = await rig.createProject({ slug: "beta", path: "/p/beta" });
    const dispA = await rig.prisma.dispatch.create({
      data: {
        projectId: projA.id,
        projectSlug: "alpha",
        mode: "continue",
        status: "started",
        startedAt: new Date(),
      },
    });
    const dispB = await rig.prisma.dispatch.create({
      data: {
        projectId: projB.id,
        projectSlug: "beta",
        mode: "continue",
        status: "started",
        startedAt: new Date(),
      },
    });

    const spoolPath = scratchSpool();
    fs.writeFileSync(
      spoolPath,
      JSON.stringify({ projectPath: "/p/alpha", idempotencyKey: dispA.idempotencyKey }) +
        "\n" +
        JSON.stringify({ projectPath: "/p/beta", idempotencyKey: dispB.idempotencyKey }) +
        "\n"
    );

    const result = await drainWebhookSpool(rig.prisma, { spoolPath });

    expect(result.ingested).toBe(2);
    const outcomes = await rig.getDispatchOutcomes();
    expect(outcomes).toHaveLength(2);
    // Both dispatches transitioned to completed — the live-post effect.
    const dispatches = await rig.getDispatches();
    expect(dispatches.every((d) => d.status === "completed")).toBe(true);
    // Spool fully drained.
    expect(fs.existsSync(spoolPath)).toBe(false);
  });
});

describe("drainWebhookSpool — atomic vs concurrent writes", () => {
  it("a Stop-hook append during drain survives and is not double-ingested", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const spoolPath = scratchSpool();
    const lineA = JSON.stringify({ projectPath: "/p/alpha", idempotencyKey: "a" });
    const lineB = JSON.stringify({ projectPath: "/p/beta", idempotencyKey: "b" });
    fs.writeFileSync(spoolPath, lineA + "\n");

    const seen: string[] = [];
    // Injected ingest simulates a Stop hook firing mid-drain: it appends
    // a NEW entry to the live spool path while the batch is being
    // processed. Because the drain rotated the file aside first, the
    // late append lands in a fresh spool and must survive untouched.
    const ingest = vi.fn(async (_prisma: unknown, input: { projectPath: string }) => {
      seen.push(input.projectPath);
      fs.appendFileSync(spoolPath, lineB + "\n");
      return { ok: true, slug: "x" };
    });

    const result = await drainWebhookSpool(rig.prisma, { spoolPath, ingest });

    // Only entry A was ingested (once) — B arrived after rotation.
    expect(seen).toEqual(["/p/alpha"]);
    expect(result.ingested).toBe(1);
    // B survives in the spool for the next drain, not lost, not doubled.
    expect(fs.existsSync(spoolPath)).toBe(true);
    const remaining = fs
      .readFileSync(spoolPath, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(remaining).toEqual([lineB]);
  });
});

describe("drainWebhookSpool — malformed lines", () => {
  it("skips + quarantines corrupt lines, ingests the valid ones, logs", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const spoolPath = scratchSpool();
    const validLine = JSON.stringify({ projectPath: "/p/alpha", idempotencyKey: "a" });
    fs.writeFileSync(spoolPath, validLine + "\n" + "{ this is not json\n");

    const logs: Array<Record<string, unknown>> = [];
    const ingest = vi.fn(async () => ({ ok: true, slug: "alpha" }));

    const result = await drainWebhookSpool(rig.prisma, {
      spoolPath,
      ingest,
      logger: (e) => logs.push(e),
    });

    expect(result.ingested).toBe(1);
    expect(result.skipped).toBe(1);
    expect(ingest).toHaveBeenCalledTimes(1);
    // Corrupt line quarantined, not silently dropped.
    const quarantinePath = `${spoolPath}.quarantine`;
    expect(fs.existsSync(quarantinePath)).toBe(true);
    expect(fs.readFileSync(quarantinePath, "utf-8")).toContain("this is not json");
    // Malformed line was logged.
    expect(logs.some((e) => String(e.event).includes("malformed"))).toBe(true);
  });
});

describe("drainWebhookSpool — idempotent ingestion", () => {
  it("the same payload drained twice produces a single outcome", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const proj = await rig.createProject({ slug: "alpha", path: "/p/alpha" });
    const disp = await rig.prisma.dispatch.create({
      data: {
        projectId: proj.id,
        projectSlug: "alpha",
        mode: "continue",
        status: "started",
        startedAt: new Date(),
      },
    });

    const spoolPath = scratchSpool();
    const line = JSON.stringify({
      projectPath: "/p/alpha",
      idempotencyKey: disp.idempotencyKey,
    });
    // Same payload appears twice in the spool.
    fs.writeFileSync(spoolPath, line + "\n" + line + "\n");

    await drainWebhookSpool(rig.prisma, { spoolPath });

    // Dispatcher dedups on idempotencyKey — one outcome, not two.
    const outcomes = await rig.getDispatchOutcomes("alpha");
    expect(outcomes).toHaveLength(1);
  });
});
