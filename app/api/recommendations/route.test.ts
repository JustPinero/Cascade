/**
 * Phase 40 [P3] — route tests for the recommendations endpoint.
 *
 * Same @/lib/db proxy-injection boilerplate as the dispatch/status and
 * webhook route tests — the rig owns a scratch SQLite, and we point the
 * mocked prisma at it via globalThis.__rigPrisma around the handler call.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

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
import type { Recommendation } from "@/lib/dispatch-recommendations";

let rig: DispatchRig | null = null;

afterEach(async () => {
  delete (globalThis as Record<string, unknown>).__rigPrisma;
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

interface Body {
  recommendations: Recommendation[];
}

async function callRoute(): Promise<Body> {
  (globalThis as Record<string, unknown>).__rigPrisma = rig!.prisma;
  const res = await GET();
  expect(res.status).toBe(200);
  return (await res.json()) as Body;
}

async function seedOutcome(
  projectId: number,
  slug: string,
  mode: string,
  outcome: string,
  opts: {
    signals?: string;
    completedAt?: Date;
    goalAchieved?: boolean | null;
  } = {}
): Promise<void> {
  await rig!.prisma.dispatchOutcome.create({
    data: {
      projectId,
      projectSlug: slug,
      mode,
      healthAtDispatch: "healthy",
      outcome,
      signals: opts.signals ?? "[]",
      dispatchedAt: new Date(),
      completedAt: opts.completedAt ?? new Date(),
      goalAchieved: opts.goalAchieved ?? null,
    },
  });
}

describe("GET /api/recommendations", () => {
  it("AC7: returns an empty list on a system with no outcomes", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const body = await callRoute();
    expect(body.recommendations).toEqual([]);
  });

  it("AC7: aggregates outcomes into a low-signal recommendation", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "medipal", path: "/p/medipal" });
    for (let i = 0; i < 4; i++) {
      await seedOutcome(project.id, "medipal", "audit", "success");
    }

    const body = await callRoute();
    const rec = body.recommendations.find(
      (r) => r.projectSlug === "medipal" && r.kind === "low-signal-mode"
    );
    expect(rec).toBeDefined();
    expect(rec!.suggestedMode).toBe("continue");
    expect(rec!.count).toBe(4);
  });

  it("AC8: ignores outcomes older than the window", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "stale", path: "/p/stale" });
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    for (let i = 0; i < 4; i++) {
      await seedOutcome(project.id, "stale", "audit", "success", {
        completedAt: old,
      });
    }

    const body = await callRoute();
    expect(
      body.recommendations.some((r) => r.projectSlug === "stale")
    ).toBe(false);
  });

  // Phase 41.2 — goalAchieved must flow from the DB into the engine.
  it("41.2: goal-verified successes are weighted above self-reported ones end-to-end", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const verified = await rig.createProject({
      slug: "verified",
      path: "/p/verified",
    });
    const selfReported = await rig.createProject({
      slug: "self-reported",
      path: "/p/self-reported",
    });

    // Same raw shape for both: 2 successes + 3 blockers on continue.
    for (const [project, goalAchieved] of [
      [verified, true],
      [selfReported, null],
    ] as const) {
      for (let i = 0; i < 2; i++) {
        await seedOutcome(project.id, project.slug, "continue", "success", {
          goalAchieved,
        });
      }
      for (let i = 0; i < 3; i++) {
        await seedOutcome(project.id, project.slug, "continue", "blocker", {
          signals: JSON.stringify(["human-todo"]),
        });
      }
    }

    const body = await callRoute();
    const failing = body.recommendations.filter(
      (r) => r.kind === "failing-mode"
    );
    expect(failing.map((r) => r.projectSlug)).toEqual(["self-reported"]);
  });

  it("AC8: parses malformed signals JSON defensively", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({ slug: "garbled", path: "/p/garbled" });
    // Malformed signals must not throw — treated as no signals, so 3 clean
    // audits still read as low-signal rather than crashing the route.
    for (let i = 0; i < 3; i++) {
      await seedOutcome(project.id, "garbled", "audit", "success", {
        signals: "{not json",
      });
    }

    const body = await callRoute();
    const rec = body.recommendations.find((r) => r.projectSlug === "garbled");
    expect(rec).toBeDefined();
    expect(rec!.kind).toBe("low-signal-mode");
  });
});
