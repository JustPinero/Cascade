import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import {
  generateSingleReport,
  generateCrossProjectReport,
  reportToMarkdown,
} from "./report-generator";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-reports.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;

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

  const project = await prisma.project.create({
    data: {
      name: "Report Test",
      slug: "report-test",
      path: "/tmp/report-test",
      health: "warning",
      status: "building",
      currentPhase: "phase-2-dashboard",
    },
  });

  await prisma.auditSnapshot.create({
    data: {
      projectId: project.id,
      phase: "phase-1",
      auditType: "test-audit",
      grade: "B",
    },
  });

  await prisma.activityEvent.create({
    data: {
      projectId: project.id,
      eventType: "commit",
      summary: "Added login feature",
    },
  });

  await prisma.knowledgeLesson.create({
    data: {
      title: "Test lesson",
      content: "Test content",
      category: "testing",
      tags: "[]",
      sourceProjectId: project.id,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
});

describe("report-generator", () => {
  it("generates single project report", async () => {
    const report = await generateSingleReport(prisma, "report-test");
    expect(report).not.toBeNull();
    expect(report!.projectName).toBe("Report Test");
    expect(report!.health).toBe("warning");
    expect(report!.audits).toHaveLength(1);
    expect(report!.timeline).toHaveLength(1);
  });

  it("returns null for missing project", async () => {
    const report = await generateSingleReport(prisma, "nonexistent");
    expect(report).toBeNull();
  });

  it("generates cross-project report", async () => {
    const report = await generateCrossProjectReport(prisma);
    expect(report.projects).toHaveLength(1);
    expect(report.totalLessons).toBe(1);
    expect(report.lessonsByCategory.testing).toBe(1);
  });

  it("converts single report to markdown", async () => {
    const report = await generateSingleReport(prisma, "report-test");
    const md = reportToMarkdown(report!);
    expect(md).toContain("# Project Report: Report Test");
    expect(md).toContain("test-audit");
    expect(md).toContain("Added login feature");
  });

  it("converts cross-project report to markdown", async () => {
    const report = await generateCrossProjectReport(prisma);
    const md = reportToMarkdown(report);
    expect(md).toContain("# Cross-Project Summary Report");
    expect(md).toContain("Report Test");
    expect(md).toContain("testing: 1");
  });
});
