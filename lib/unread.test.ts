import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { getUnreadCount, getAllUnreadCounts, markAuditsRead } from "./unread";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-unread.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;
let projectId: number;

beforeAll(async () => {
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  // Create a project
  const project = await prisma.project.create({
    data: {
      name: "Unread Test",
      slug: "unread-test",
      path: "/tmp/unread-test",
    },
  });
  projectId = project.id;

  // Create some audit snapshots (2 unread, 1 read)
  await prisma.auditSnapshot.createMany({
    data: [
      {
        projectId,
        phase: "phase-1",
        auditType: "test-audit",
        isRead: false,
      },
      {
        projectId,
        phase: "phase-1",
        auditType: "bughunt",
        isRead: false,
      },
      {
        projectId,
        phase: "phase-1",
        auditType: "optimize",
        isRead: true,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
});

describe("unread", () => {
  it("getUnreadCount returns correct count", async () => {
    const count = await getUnreadCount(prisma, projectId);
    expect(count).toBe(2);
  });

  it("getAllUnreadCounts returns map with correct counts", async () => {
    const counts = await getAllUnreadCounts(prisma);
    expect(counts.get(projectId)).toBe(2);
  });

  it("markAuditsRead marks all unread as read", async () => {
    const marked = await markAuditsRead(prisma, projectId);
    expect(marked).toBe(2);

    const count = await getUnreadCount(prisma, projectId);
    expect(count).toBe(0);
  });

  it("markAuditsRead returns 0 when all already read", async () => {
    const marked = await markAuditsRead(prisma, projectId);
    expect(marked).toBe(0);
  });
});
