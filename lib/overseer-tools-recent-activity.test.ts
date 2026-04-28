import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { recentActivityTool } from "@/lib/overseer-tools-recent-activity";
import type { ToolContext } from "@/lib/overseer-tools";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-recent-activity.db");
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
  await prisma.activityEvent.deleteMany({});
  await prisma.project.deleteMany({});
});

describe("recentActivityTool", () => {
  it("returns events ordered newest-first with project info populated", async () => {
    const project = await prisma.project.create({
      data: { name: "Cascade", slug: "cascade", path: "/tmp/c" },
    });
    await prisma.activityEvent.create({
      data: { projectId: project.id, eventType: "phase-complete", summary: "phase 1 done" },
    });
    await prisma.activityEvent.create({
      data: { eventType: "lesson-harvested", summary: "Harvested 5 lessons" },
    });

    const out = await recentActivityTool.handler({}, ctx());
    expect(out.totalReturned).toBe(2);
    // newest first — the cross-project event was created last
    expect(out.events[0].eventType).toBe("lesson-harvested");
    expect(out.events[0].projectSlug).toBeNull();
    expect(out.events[1].projectSlug).toBe("cascade");
    expect(out.events[1].projectName).toBe("Cascade");
  });

  it("filters by projectSlug", async () => {
    const a = await prisma.project.create({ data: { name: "A", slug: "a", path: "/tmp/a" } });
    const b = await prisma.project.create({ data: { name: "B", slug: "b", path: "/tmp/b" } });
    await prisma.activityEvent.create({
      data: { projectId: a.id, eventType: "commit", summary: "x" },
    });
    await prisma.activityEvent.create({
      data: { projectId: b.id, eventType: "commit", summary: "y" },
    });

    const out = await recentActivityTool.handler({ projectSlug: "a" }, ctx());
    expect(out.totalReturned).toBe(1);
    expect(out.events[0].projectSlug).toBe("a");
  });

  it("filters by eventType", async () => {
    await prisma.activityEvent.create({
      data: { eventType: "commit", summary: "x" },
    });
    await prisma.activityEvent.create({
      data: { eventType: "audit-complete", summary: "y" },
    });

    const out = await recentActivityTool.handler({ eventType: "commit" }, ctx());
    expect(out.totalReturned).toBe(1);
    expect(out.events[0].eventType).toBe("commit");
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await prisma.activityEvent.create({
        data: { eventType: "commit", summary: `event ${i}` },
      });
    }
    const out = await recentActivityTool.handler({ limit: 2 }, ctx());
    expect(out.totalReturned).toBe(2);
  });
});
