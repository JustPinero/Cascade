import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { createHumanTodoTool } from "@/lib/overseer-tools-create-human-todo";
import { ToolRegistry, type ToolContext } from "@/lib/overseer-tools";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-create-human-todo.db");
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
  await prisma.humanTask.deleteMany({});
  await prisma.project.deleteMany({});
});

describe("createHumanTodoTool", () => {
  it("creates a task with the supplied fields, defaults category=other and priority=normal", async () => {
    const out = await createHumanTodoTool.handler(
      { title: "Upload logo to /public/images" },
      ctx()
    );
    expect(out.id).toBeDefined();
    expect(out.title).toContain("Upload");
    expect(out.category).toBe("other");
    expect(out.priority).toBe("normal");
    const row = await prisma.humanTask.findUnique({ where: { id: out.id } });
    expect(row?.createdBy).toBe("delamain");
  });

  it("links to the project when slug resolves to a real row", async () => {
    const project = await prisma.project.create({
      data: { name: "X", slug: "x", path: "/tmp/x" },
    });
    const out = await createHumanTodoTool.handler(
      { title: "test stuff", projectSlug: "x", category: "testing", priority: "high" },
      ctx()
    );
    const row = await prisma.humanTask.findUnique({ where: { id: out.id } });
    expect(row?.projectId).toBe(project.id);
    expect(row?.category).toBe("testing");
    expect(row?.priority).toBe("high");
  });

  it("does not link to a project when slug does not resolve (still creates the task)", async () => {
    const out = await createHumanTodoTool.handler(
      { title: "yo", projectSlug: "missing-thing" },
      ctx()
    );
    const row = await prisma.humanTask.findUnique({ where: { id: out.id } });
    expect(row?.projectId).toBeNull();
    expect(row?.projectSlug).toBe("missing-thing");
  });

  it("rejects unknown category via the registry", async () => {
    const reg = new ToolRegistry();
    reg.register(createHumanTodoTool);
    const result = await reg.execute(
      "create_human_todo",
      { title: "x", category: "imaginary" },
      { prisma }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unknown category/);
  });
});
