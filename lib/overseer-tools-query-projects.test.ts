import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { queryProjectsTool } from "@/lib/overseer-tools-query-projects";
import type { ToolContext } from "@/lib/overseer-tools";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-query-projects.db");
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
  await prisma.project.deleteMany({});
});

async function seed() {
  const now = Date.now();
  await prisma.project.create({
    data: {
      name: "Cascade",
      slug: "cascade",
      path: "/tmp/c",
      status: "building",
      health: "healthy",
      currentPhase: "phase-12",
      progressScore: 60,
      lastActivityAt: new Date(now),
    },
  });
  await prisma.project.create({
    data: {
      name: "medipal",
      slug: "medipal",
      path: "/tmp/m",
      status: "building",
      health: "blocked",
      currentPhase: "phase-3",
      progressScore: 30,
      lastActivityAt: new Date(now - 1000),
    },
  });
  await prisma.project.create({
    data: {
      name: "Old",
      slug: "old",
      path: "/tmp/o",
      status: "backburner",
      health: "idle",
      lastActivityAt: new Date(now - 100000),
    },
  });
  await prisma.project.create({
    data: {
      name: "Archived",
      slug: "archived-thing",
      path: "/tmp/a",
      status: "archived",
      lastActivityAt: new Date(now - 200000),
    },
  });
}

describe("queryProjectsTool", () => {
  it("declares name + schema", () => {
    expect(queryProjectsTool.name).toBe("query_projects");
    expect(queryProjectsTool.inputSchema).toBeDefined();
  });

  it("excludes backburner + archived by default and orders by lastActivityAt desc", async () => {
    await seed();
    const out = await queryProjectsTool.handler({}, ctx());
    expect(out.projects.map((p) => p.slug)).toEqual(["cascade", "medipal"]);
    expect(out.totalReturned).toBe(2);
  });

  it("includes backburner when includeBackburner=true", async () => {
    await seed();
    const out = await queryProjectsTool.handler({ includeBackburner: true }, ctx());
    expect(out.projects.map((p) => p.slug)).toContain("old");
  });

  it("filters by status", async () => {
    await seed();
    const out = await queryProjectsTool.handler({ status: ["backburner"] }, ctx());
    expect(out.projects.map((p) => p.slug)).toEqual(["old"]);
  });

  it("filters by health", async () => {
    await seed();
    const out = await queryProjectsTool.handler({ health: ["blocked"] }, ctx());
    expect(out.projects.map((p) => p.slug)).toEqual(["medipal"]);
  });

  it("respects limit", async () => {
    await seed();
    const out = await queryProjectsTool.handler({ limit: 1 }, ctx());
    expect(out.totalReturned).toBe(1);
  });

  it("returns ISO strings for lastActivityAt", async () => {
    await seed();
    const out = await queryProjectsTool.handler({ limit: 1 }, ctx());
    expect(out.projects[0].lastActivityAtISO).toMatch(/T.*Z$/);
  });
});
