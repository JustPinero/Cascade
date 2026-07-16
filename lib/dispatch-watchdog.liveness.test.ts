/**
 * Phase 42 (P0.2b) — watchdog liveness probe.
 *
 * A `started` row past expectedBy whose transcript shows recent
 * activity is a LONG session, not a hung one. Timing it out released
 * the queue slot while the process was still running, stacking a
 * second CLI process against the RAM cap. The watchdog now probes
 * before flipping: recent activity ⇒ extend expectedBy and keep the
 * slot; no activity ⇒ time out exactly as before.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import { runDispatchWatchdog } from "./dispatch-watchdog";
import { encodeTranscriptDirName, defaultLivenessProbe } from "./dispatch-liveness";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";
import fs from "fs";
import os from "os";
import path from "path";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

async function makeStartedRowPastDeadline(r: DispatchRig, slug: string) {
  const project = await r.createProject({ slug, path: `/p/${slug}` });
  const now = Date.now();
  return r.prisma.dispatch.create({
    data: {
      projectId: project.id,
      projectSlug: slug,
      mode: "continue",
      status: "started",
      startedAt: new Date(now - 45 * 60_000),
      expectedBy: new Date(now - 60_000), // deadline passed a minute ago
    },
  });
}

describe("runDispatchWatchdog — liveness probe", () => {
  it("extends live sessions instead of timing out", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const row = await makeStartedRowPastDeadline(rig, "alpha");
    const now = new Date();

    const result = await runDispatchWatchdog(rig.prisma, rig.queue, now, {
      // transcript activity 30s ago — clearly alive
      livenessProbe: () => new Date(now.getTime() - 30_000),
    });

    expect(result.timedOut).toBe(0);
    expect(result.extended).toBe(1);
    const after = await rig.prisma.dispatch.findUnique({
      where: { id: row.id },
    });
    expect(after?.status).toBe("started");
    expect(after?.expectedBy!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("still times out rows with no recent activity", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await makeStartedRowPastDeadline(rig, "beta");
    const now = new Date();

    const result = await runDispatchWatchdog(rig.prisma, rig.queue, now, {
      // last activity 30 minutes ago — dead
      livenessProbe: () => new Date(now.getTime() - 30 * 60_000),
    });

    expect(result.timedOut).toBe(1);
    expect(result.extended).toBe(0);
    const rows = await rig.getDispatches("beta");
    expect(rows[0].status).toBe("timeout");
  });

  it("times out when the probe has no signal (null)", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    await makeStartedRowPastDeadline(rig, "gamma");

    const result = await runDispatchWatchdog(rig.prisma, rig.queue, new Date(), {
      livenessProbe: () => null,
    });

    expect(result.timedOut).toBe(1);
    const rows = await rig.getDispatches("gamma");
    expect(rows[0].status).toBe("timeout");
  });

  it("never probes queued rows (no session exists yet)", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({ slug: "delta", path: "/p/delta" });
    await rig.prisma.dispatch.create({
      data: {
        projectId: project.id,
        projectSlug: "delta",
        mode: "continue",
        status: "queued",
        expectedBy: new Date(Date.now() - 60_000),
      },
    });
    const probe = vi.fn(() => new Date());

    const result = await runDispatchWatchdog(rig.prisma, rig.queue, new Date(), {
      livenessProbe: probe,
    });

    expect(probe).not.toHaveBeenCalled();
    expect(result.timedOut).toBe(1);
  });
});

describe("defaultLivenessProbe", () => {
  it("returns newest jsonl mtime from the encoded transcript dir", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "liveness-"));
    const projectPath = "/p/epsilon";
    const dir = path.join(
      home,
      ".claude",
      "projects",
      encodeTranscriptDirName(projectPath)
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "old.jsonl"), "{}");
    const oldTime = new Date(Date.now() - 60 * 60_000);
    fs.utimesSync(path.join(dir, "old.jsonl"), oldTime, oldTime);
    fs.writeFileSync(path.join(dir, "new.jsonl"), "{}");

    const result = defaultLivenessProbe(projectPath, home);
    expect(result).not.toBeNull();
    expect(Date.now() - result!.getTime()).toBeLessThan(60_000);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("returns null for unknown dirs", () => {
    expect(defaultLivenessProbe("/p/never-existed", "/nonexistent-home")).toBe(
      null
    );
  });

  it("encodes like Claude Code (verified against real dirs)", () => {
    expect(
      encodeTranscriptDirName("/Users/justinpinero/Desktop/projects/hr_hero")
    ).toBe("-Users-justinpinero-Desktop-projects-hr-hero");
    expect(
      encodeTranscriptDirName("/Users/justinpinero/Desktop/projects/CON-CORE")
    ).toBe("-Users-justinpinero-Desktop-projects-CON-CORE");
  });
});
