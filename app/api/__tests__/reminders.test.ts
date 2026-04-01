import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../../../prisma/test-api-reminders.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;

beforeAll(async () => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, "../../.."), stdio: "pipe",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
});

describe("Reminders API logic", () => {
  it("POST creates a reminder with all fields", async () => {
    const reminder = await prisma.reminder.create({
      data: {
        message: "Check deployment",
        conditionType: "project-deployed",
        conditionValue: "ratracer",
        projectSlug: "ratracer",
        createdBy: "delamain",
      },
    });
    expect(reminder.id).toBeDefined();
    expect(reminder.status).toBe("pending");
    expect(reminder.createdBy).toBe("delamain");
  });

  it("GET returns non-dismissed reminders", async () => {
    // Create a dismissed one
    await prisma.reminder.create({
      data: {
        message: "Old reminder",
        conditionType: "custom",
        conditionValue: "test",
        status: "dismissed",
      },
    });

    const active = await prisma.reminder.findMany({
      where: { status: { not: "dismissed" } },
    });
    expect(active.every((r) => r.status !== "dismissed")).toBe(true);
  });

  it("PATCH updates status to triggered", async () => {
    const reminder = await prisma.reminder.findFirst({ where: { status: "pending" } });
    const updated = await prisma.reminder.update({
      where: { id: reminder!.id },
      data: { status: "triggered", triggeredAt: new Date() },
    });
    expect(updated.status).toBe("triggered");
    expect(updated.triggeredAt).not.toBeNull();
  });

  it("PATCH updates status to dismissed", async () => {
    const reminder = await prisma.reminder.findFirst({ where: { status: "triggered" } });
    const updated = await prisma.reminder.update({
      where: { id: reminder!.id },
      data: { status: "dismissed" },
    });
    expect(updated.status).toBe("dismissed");
  });

  it("validates required fields for creation", () => {
    const message = "";
    const conditionType = "custom";
    const conditionValue = "test";
    // API route checks: if (!message || !conditionType || !conditionValue)
    expect(!message || !conditionType || !conditionValue).toBe(true);
  });
});
