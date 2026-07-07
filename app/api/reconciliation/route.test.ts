/**
 * Phase 41.4 — GET /api/reconciliation: the fleet dashboard's drift
 * surface. Runs the reconciler over Project rows (fetch disabled for a
 * fast local-only pass) and returns a count + per-project findings list.
 */
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";

vi.mock("@/lib/db", () => {
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      const inj = (globalThis as Record<string, unknown>).__rigPrisma;
      if (!inj) {
        throw new Error("rig prisma not injected — set __rigPrisma in the test");
      }
      return (inj as Record<string, unknown>)[prop as string];
    },
  });
  return { prisma: proxy };
});

import { GET } from "./route";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

const TEST_DIR = path.resolve(__dirname, "../../../.test-reconcile-route");

let rig: DispatchRig | null = null;

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

afterEach(async () => {
  delete (globalThis as Record<string, unknown>).__rigPrisma;
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

describe("GET /api/reconciliation", () => {
  it("returns drifted projects with typed findings", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    (globalThis as Record<string, unknown>).__rigPrisma = rig.prisma;

    await rig.prisma.project.create({
      data: {
        name: "GhostProject",
        slug: "ghost-project",
        path: path.join(TEST_DIR, "no-longer-here"),
        status: "complete",
      },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      findingsCount: number;
      generatedAt: string;
      projects: {
        slug: string;
        name: string;
        findings: { type: string; severity: string; message: string }[];
      }[];
    };

    expect(body.findingsCount).toBeGreaterThanOrEqual(1);
    expect(body.generatedAt).toBeTruthy();
    const ghost = body.projects.find((p) => p.slug === "ghost-project");
    expect(ghost).toBeDefined();
    expect(ghost!.findings.map((f) => f.type)).toContain("path-missing");
    for (const f of ghost!.findings) {
      expect(f.severity).toBeTruthy();
      expect(f.message).toBeTruthy();
    }
  });

  it("returns an empty drift list when the fleet is consistent", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    (globalThis as Record<string, unknown>).__rigPrisma = rig.prisma;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      findingsCount: number;
      projects: unknown[];
    };
    expect(body.findingsCount).toBe(0);
    expect(body.projects).toHaveLength(0);
  });
});
