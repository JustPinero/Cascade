import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { checkReminders, parseReminders } from "./reminders";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-reminders.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;

beforeAll(async () => {
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, ".."), stdio: "pipe",
  });

  // Create a project
  await prisma.project.create({
    data: { name: "Test", slug: "test", path: "/tmp/test", health: "healthy", status: "building", currentPhase: "phase-3-knowledge" },
  });

  // Create pending reminders
  await prisma.reminder.create({
    data: { message: "Review auth", conditionType: "project-health", conditionValue: "test:healthy", projectSlug: "test" },
  });
  await prisma.reminder.create({
    data: { message: "Wait for phase 5", conditionType: "phase-complete", conditionValue: "test:phase-5", projectSlug: "test" },
  });
  await prisma.reminder.create({
    data: { message: "Deploy check", conditionType: "project-deployed", conditionValue: "test", projectSlug: "test" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
});

describe("checkReminders", () => {
  it("triggers project-health reminder when condition met", async () => {
    const result = await checkReminders(prisma);
    // "test" project is healthy, so "test:healthy" reminder should trigger
    expect(result.triggered).toBeGreaterThanOrEqual(1);
    const healthReminder = result.reminders.find((r) => r.message === "Review auth");
    expect(healthReminder).toBeDefined();
  });

  it("does NOT trigger phase-complete when phase not reached", async () => {
    const result = await checkReminders(prisma);
    const phaseReminder = result.reminders.find((r) => r.message === "Wait for phase 5");
    expect(phaseReminder).toBeUndefined(); // phase-3 < phase-5
  });

  it("does NOT trigger project-deployed when not deployed", async () => {
    const result = await checkReminders(prisma);
    const deployReminder = result.reminders.find((r) => r.message === "Deploy check");
    expect(deployReminder).toBeUndefined(); // status is "building"
  });

  it("marks triggered reminders with triggeredAt", async () => {
    const triggered = await prisma.reminder.findFirst({
      where: { message: "Review auth" },
    });
    expect(triggered!.status).toBe("triggered");
    expect(triggered!.triggeredAt).not.toBeNull();
  });
});

describe("parseReminders", () => {
  it("parses [REMINDER] tags from text", () => {
    const text = `I'll set up monitoring.
[REMINDER] project-deployed:ratracer — Set up alerts after deploy
[REMINDER] phase-complete:sitelift:phase-2 — Review design before phase 3`;

    const reminders = parseReminders(text);
    expect(reminders).toHaveLength(2);
    expect(reminders[0].conditionType).toBe("project-deployed");
    expect(reminders[0].conditionValue).toBe("ratracer");
    expect(reminders[0].message).toBe("Set up alerts after deploy");
    expect(reminders[1].conditionType).toBe("phase-complete");
  });

  it("returns empty array for text without reminders", () => {
    expect(parseReminders("Just a normal message")).toEqual([]);
  });

  it("extracts project slug from condition value", () => {
    const text = "[REMINDER] project-health:medipal:blocked — Check medipal";
    const reminders = parseReminders(text);
    expect(reminders[0].projectSlug).toBe("medipal");
  });
});
