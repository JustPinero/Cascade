/**
 * Phase 41.2 — goal-state ingestion on the Stop-hook webhook.
 *
 * AC4: DispatchOutcome records goal state (goalCondition, goalAchieved,
 *      goalReason) — schema fields apply via `prisma db push` (the rig
 *      template DB is built by db push from schema.prisma).
 * AC5: session-complete ingestion parses goal achievement from the
 *      session log — fixture-driven; absence of a marker never throws
 *      and leaves goalAchieved null.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

// Boilerplate prisma injection for the route handler — see fireWebhook
// JSDoc in tests/harness/dispatch-rig.ts.
vi.mock("@/lib/db", () => {
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      const inj = (globalThis as Record<string, unknown>).__rigPrisma;
      if (!inj) {
        throw new Error(
          "rig prisma not injected — call rig.fireWebhook(...) inside a test"
        );
      }
      return (inj as Record<string, unknown>)[prop as string];
    },
  });
  return { prisma: proxy };
});

vi.mock("@/lib/project-import", () => ({
  importSingleProject: vi.fn(async (_p: unknown, projectPath: string) => ({
    slug: projectPath.split("/").pop() ?? "test",
    name: projectPath.split("/").pop() ?? "test",
    action: "scanned",
  })),
}));

vi.mock("@/lib/anthropic-feature-check", () => ({
  auditProjectFeatureUsage: vi.fn(async () => undefined),
}));

// Controllable session-log fixture store — each test sets the log
// content the webhook's escalation/goal parsing will see.
const sessionLogState = vi.hoisted(() => ({
  logs: [] as {
    filename: string;
    timestamp: string;
    content: string;
    summary: string;
  }[],
}));

vi.mock("@/lib/session-reader", () => ({
  getSessionLogs: vi.fn(async () => sessionLogState.logs),
}));

import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  sessionLogState.logs = [];
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

function logFixture(content: string): void {
  sessionLogState.logs = [
    {
      filename: "2026-07-07T10-00-00.md",
      timestamp: "2026-07-07T10:00:00",
      content,
      summary: content.slice(0, 500),
    },
  ];
}

const GOAL_CONDITION =
  "Work until all acceptance criteria are met: search works. Also required: scripts/validate.sh exits 0, shown by running it in this session. Or stop after 50 turns and report what is blocking.";

async function seedDispatch(slug: string, prompt: string | null) {
  const project = await rig!.createProject({ slug, path: `/p/${slug}` });
  const dispatch = await rig!.prisma.dispatch.create({
    data: {
      projectId: project.id,
      projectSlug: project.slug,
      mode: "continue",
      status: "started",
      healthAtDispatch: "healthy",
      startedAt: new Date(),
      prompt,
    },
  });
  return { project, dispatch };
}

describe("POST /api/webhook/session-complete — goal ingestion (41.2)", () => {
  it("AC4 schema: DispatchOutcome persists goalCondition/goalAchieved/goalReason", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "schema-check",
      path: "/p/schema-check",
    });
    await rig.prisma.dispatchOutcome.create({
      data: {
        projectId: project.id,
        projectSlug: "schema-check",
        mode: "continue",
        healthAtDispatch: "healthy",
        outcome: "success",
        signals: "[]",
        dispatchedAt: new Date(),
        goalCondition: GOAL_CONDITION,
        goalAchieved: true,
        goalReason: "evaluator confirmed",
      },
    });
    const row = await rig.prisma.dispatchOutcome.findFirst({
      where: { projectSlug: "schema-check" },
    });
    expect(row?.goalCondition).toBe(GOAL_CONDITION);
    expect(row?.goalAchieved).toBe(true);
    expect(row?.goalReason).toBe("evaluator confirmed");
  });

  it("AC5: achieved-goal marker in the log → goalAchieved=true with reason", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const { dispatch } = await seedDispatch(
      "goal-hit",
      `/goal ${GOAL_CONDITION}\nRead CLAUDE.md and continue.`
    );
    logFixture(
      "# Session\nRan scripts/validate.sh — exit 0.\n[GOAL ACHIEVED] all criteria verified; validate.sh exited 0\n"
    );

    const result = await rig.fireWebhook({
      projectPath: "/p/goal-hit",
      idempotencyKey: dispatch.idempotencyKey,
    });
    expect(result.status).toBe(200);

    const row = await rig.prisma.dispatchOutcome.findFirst({
      where: { projectSlug: "goal-hit" },
    });
    expect(row).not.toBeNull();
    expect(row!.goalAchieved).toBe(true);
    expect(row!.goalReason).toContain("validate.sh exited 0");
    // Condition recovered from the dispatch's composed prompt.
    expect(row!.goalCondition).toBe(GOAL_CONDITION);
  });

  it("AC5: not-achieved marker → goalAchieved=false with reason", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const { dispatch } = await seedDispatch(
      "goal-miss",
      `/goal ${GOAL_CONDITION}\nRead CLAUDE.md and continue.`
    );
    logFixture("[GOAL NOT ACHIEVED] stopped after 50 turns, tests failing\n");

    await rig.fireWebhook({
      projectPath: "/p/goal-miss",
      idempotencyKey: dispatch.idempotencyKey,
    });

    const row = await rig.prisma.dispatchOutcome.findFirst({
      where: { projectSlug: "goal-miss" },
    });
    expect(row!.goalAchieved).toBe(false);
    expect(row!.goalReason).toContain("stopped after 50 turns");
  });

  it("AC5: log without a goal marker → goalAchieved null, never throws", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const { dispatch } = await seedDispatch(
      "no-marker",
      `/goal ${GOAL_CONDITION}\nRead CLAUDE.md and continue.`
    );
    logFixture("# Session\nA perfectly ordinary log with no verdict.\n");

    const result = await rig.fireWebhook({
      projectPath: "/p/no-marker",
      idempotencyKey: dispatch.idempotencyKey,
    });
    expect(result.status).toBe(200);

    const row = await rig.prisma.dispatchOutcome.findFirst({
      where: { projectSlug: "no-marker" },
    });
    expect(row).not.toBeNull();
    expect(row!.goalAchieved).toBeNull();
    expect(row!.goalReason).toBeNull();
  });

  it("AC5: no session log at all → outcome still written, goal fields null", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    // Ad-hoc dispatch: prompt without a /goal line.
    const { dispatch } = await seedDispatch(
      "no-log",
      "Read CLAUDE.md and continue."
    );
    sessionLogState.logs = [];

    const result = await rig.fireWebhook({
      projectPath: "/p/no-log",
      idempotencyKey: dispatch.idempotencyKey,
    });
    expect(result.status).toBe(200);

    const row = await rig.prisma.dispatchOutcome.findFirst({
      where: { projectSlug: "no-log" },
    });
    expect(row).not.toBeNull();
    expect(row!.goalCondition).toBeNull();
    expect(row!.goalAchieved).toBeNull();
    expect(row!.goalReason).toBeNull();
  });

  it("AC5: legacy (no idempotencyKey) path still parses goal achievement", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const project = await rig.createProject({
      slug: "legacy-goal",
      path: "/p/legacy-goal",
    });
    await rig.prisma.activityEvent.create({
      data: {
        projectId: project.id,
        eventType: "session-launched",
        summary: "Dispatched: continue mode",
        details: JSON.stringify({ mode: "continue" }),
      },
    });
    logFixture("[GOAL ACHIEVED] criteria met\n");

    const result = await rig.fireWebhook({ projectPath: "/p/legacy-goal" });
    expect(result.status).toBe(200);

    const row = await rig.prisma.dispatchOutcome.findFirst({
      where: { projectSlug: "legacy-goal" },
    });
    expect(row).not.toBeNull();
    expect(row!.goalAchieved).toBe(true);
    // No Dispatch row → no composed prompt → no recoverable condition.
    expect(row!.goalCondition).toBeNull();
  });
});
