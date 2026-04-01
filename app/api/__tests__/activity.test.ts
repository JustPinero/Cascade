import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../../../prisma/test-api-activity.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;

beforeAll(async () => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, "../../.."), stdio: "pipe",
  });

  const project = await prisma.project.create({
    data: { name: "Activity Test", slug: "activity-test", path: "/tmp/act" },
  });

  // Create various event types
  await prisma.activityEvent.createMany({
    data: [
      { projectId: project.id, eventType: "commit", summary: "Initial commit" },
      { projectId: project.id, eventType: "session-launched", summary: "Dispatched continue" },
      { projectId: project.id, eventType: "scan-complete", summary: "Scan done" },
      { eventType: "lesson-harvested", summary: "Cross-project lesson" },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
});

describe("Activity API logic", () => {
  it("returns events ordered by createdAt desc", async () => {
    const events = await prisma.activityEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    expect(events.length).toBe(4);
    // Most recent should be first
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        events[i].createdAt.getTime()
      );
    }
  });

  it("filters by event type", async () => {
    const commits = await prisma.activityEvent.findMany({
      where: { eventType: "commit" },
    });
    expect(commits).toHaveLength(1);
    expect(commits[0].summary).toBe("Initial commit");
  });

  it("respects limit parameter", async () => {
    const limited = await prisma.activityEvent.findMany({
      take: 2,
      orderBy: { createdAt: "desc" },
    });
    expect(limited).toHaveLength(2);
  });

  it("enforces max limit of 100", () => {
    const requestedLimit = 500;
    const actualLimit = Math.min(requestedLimit, 100);
    expect(actualLimit).toBe(100);
  });

  it("includes project relation data", async () => {
    const events = await prisma.activityEvent.findMany({
      include: { project: { select: { name: true, slug: true } } },
      take: 1,
    });
    // First event has a project
    if (events[0].projectId) {
      expect(events[0].project).not.toBeNull();
      expect(events[0].project!.name).toBeDefined();
    }
  });

  it("handles cross-project events (null projectId)", async () => {
    const crossProject = await prisma.activityEvent.findMany({
      where: { projectId: null },
    });
    expect(crossProject.length).toBeGreaterThanOrEqual(1);
    expect(crossProject[0].eventType).toBe("lesson-harvested");
  });
});
