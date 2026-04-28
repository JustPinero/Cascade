import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { dispatchOutcomesTool } from "@/lib/overseer-tools-dispatch-outcomes";
import type { ToolContext } from "@/lib/overseer-tools";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-dispatch-outcomes.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;
function ctx(): ToolContext {
  return { prisma };
}

beforeAll(async () => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  pushTestSchema(TEST_DB_URL);
});

afterAll(async () => {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

beforeEach(async () => {
  await prisma.dispatchOutcome.deleteMany({});
  await prisma.project.deleteMany({});
});

async function seedOutcomes() {
  const project = await prisma.project.create({
    data: { name: "X", slug: "x", path: "/tmp/x" },
  });
  await prisma.dispatchOutcome.createMany({
    data: [
      {
        projectId: project.id,
        projectSlug: "x",
        mode: "continue",
        healthAtDispatch: "healthy",
        outcome: "success",
        dispatchedAt: new Date("2026-04-26T00:00:00Z"),
      },
      {
        projectId: project.id,
        projectSlug: "x",
        mode: "continue",
        healthAtDispatch: "warning",
        outcome: "blocker",
        dispatchedAt: new Date("2026-04-27T00:00:00Z"),
      },
      {
        projectId: project.id,
        projectSlug: "x",
        mode: "investigate",
        healthAtDispatch: "blocked",
        outcome: "success",
        dispatchedAt: new Date("2026-04-28T00:00:00Z"),
      },
    ],
  });
}

describe("dispatchOutcomesTool", () => {
  it("aggregates per-mode totals and computes successRate", async () => {
    await seedOutcomes();
    const out = await dispatchOutcomesTool.handler({}, ctx());
    expect(out.totalSampled).toBe(3);
    expect(out.totals.continue).toEqual({
      total: 2,
      success: 1,
      blocker: 1,
      successRate: 0.5,
    });
    expect(out.totals.investigate).toEqual({
      total: 1,
      success: 1,
      blocker: 0,
      successRate: 1,
    });
  });

  it("populates recentFailures for non-success outcomes only", async () => {
    await seedOutcomes();
    const out = await dispatchOutcomesTool.handler({}, ctx());
    expect(out.recentFailures.length).toBe(1);
    expect(out.recentFailures[0].outcome).toBe("blocker");
    expect(out.recentFailures[0].mode).toBe("continue");
  });

  it("filters by mode", async () => {
    await seedOutcomes();
    const out = await dispatchOutcomesTool.handler({ mode: "investigate" }, ctx());
    expect(Object.keys(out.totals)).toEqual(["investigate"]);
    expect(out.totalSampled).toBe(1);
  });

  it("filters by projectSlug", async () => {
    const projectA = await prisma.project.create({
      data: { name: "A", slug: "a", path: "/tmp/a" },
    });
    const projectB = await prisma.project.create({
      data: { name: "B", slug: "b", path: "/tmp/b" },
    });
    await prisma.dispatchOutcome.createMany({
      data: [
        {
          projectId: projectA.id,
          projectSlug: "a",
          mode: "continue",
          healthAtDispatch: "healthy",
          outcome: "success",
          dispatchedAt: new Date(),
        },
        {
          projectId: projectB.id,
          projectSlug: "b",
          mode: "continue",
          healthAtDispatch: "healthy",
          outcome: "blocker",
          dispatchedAt: new Date(),
        },
      ],
    });
    const out = await dispatchOutcomesTool.handler({ projectSlug: "a" }, ctx());
    expect(out.totalSampled).toBe(1);
    expect(out.totals.continue.success).toBe(1);
  });

  it("returns empty totals + zero sampled when no rows match", async () => {
    const out = await dispatchOutcomesTool.handler({}, ctx());
    expect(out.totals).toEqual({});
    expect(out.recentFailures).toEqual([]);
    expect(out.totalSampled).toBe(0);
  });
});
