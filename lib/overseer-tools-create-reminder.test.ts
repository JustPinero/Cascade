import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { createReminderTool } from "@/lib/overseer-tools-create-reminder";
import { ToolRegistry, type ToolContext } from "@/lib/overseer-tools";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-create-reminder.db");
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
  await prisma.reminder.deleteMany({});
});

describe("createReminderTool", () => {
  it("creates a reminder row with the given fields", async () => {
    const out = await createReminderTool.handler(
      {
        conditionType: "phase-complete",
        conditionValue: "ratracer:phase-2",
        message: "Review the auth implementation before phase 3",
        projectSlug: "ratracer",
      },
      ctx()
    );
    expect(out.id).toBeDefined();
    expect(out.message).toContain("Review");
    expect(out.conditionType).toBe("phase-complete");

    const row = await prisma.reminder.findUnique({ where: { id: out.id } });
    expect(row?.projectSlug).toBe("ratracer");
    expect(row?.createdBy).toBe("delamain");
  });

  it("rejects unknown conditionType via the registry", async () => {
    const reg = new ToolRegistry();
    reg.register(createReminderTool);
    const result = await reg.execute(
      "create_reminder",
      {
        conditionType: "imaginary",
        conditionValue: "x",
        message: "y",
      },
      { prisma }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unknown conditionType/);
  });
});
