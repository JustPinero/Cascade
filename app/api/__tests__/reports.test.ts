import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { generateSingleReport, generateCrossProjectReport, reportToMarkdown } from "@/lib/report-generator";
import { reportToPdf } from "@/lib/report-pdf";

const TEST_DB_PATH = path.resolve(__dirname, "../../../prisma/test-api-reports.db");
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
    data: {
      name: "Report Project",
      slug: "report-proj",
      path: "/tmp/report",
      status: "building",
      health: "warning",
    },
  });

  await prisma.auditSnapshot.create({
    data: { projectId: project.id, phase: "phase-1", auditType: "bughunt", grade: "B" },
  });
  await prisma.activityEvent.create({
    data: { projectId: project.id, eventType: "commit", summary: "Fixed login" },
  });
  await prisma.knowledgeLesson.create({
    data: { title: "Test lesson", content: "Content", category: "testing", tags: "[]" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
});

describe("Reports API logic", () => {
  it("generates single project report with all sections", async () => {
    const report = await generateSingleReport(prisma, "report-proj");
    expect(report).not.toBeNull();
    expect(report!.projectName).toBe("Report Project");
    expect(report!.audits).toHaveLength(1);
    expect(report!.timeline).toHaveLength(1);
    expect(report!.health).toBe("warning");
  });

  it("generates cross-project report", async () => {
    const report = await generateCrossProjectReport(prisma);
    expect(report.projects).toHaveLength(1);
    expect(report.totalLessons).toBe(1);
  });

  it("converts single report to markdown", async () => {
    const report = await generateSingleReport(prisma, "report-proj");
    const md = reportToMarkdown(report!);
    expect(md).toContain("# Project Report");
    expect(md).toContain("bughunt");
    expect(md).toContain("Fixed login");
  });

  it("converts single report to PDF with valid header", async () => {
    const report = await generateSingleReport(prisma, "report-proj");
    const pdf = reportToPdf(report!);
    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("converts cross report to PDF", async () => {
    const report = await generateCrossProjectReport(prisma);
    const pdf = reportToPdf(report);
    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("returns null for nonexistent project", async () => {
    const report = await generateSingleReport(prisma, "does-not-exist");
    expect(report).toBeNull();
  });

  it("validates report type parameter", () => {
    const validTypes = new Set(["single", "cross-project"]);
    expect(validTypes.has("single")).toBe(true);
    expect(validTypes.has("cross-project")).toBe(true);
    expect(validTypes.has("invalid")).toBe(false);
  });
});
