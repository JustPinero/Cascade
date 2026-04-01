import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;

beforeAll(async () => {
  // Clean up any existing test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });

  // Push schema to test database
  execSync(`DATABASE_URL="${TEST_DB_URL}" pnpm exec prisma db push`, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

describe("KickoffTemplate model", () => {
  it("creates and reads a template", async () => {
    const template = await prisma.kickoffTemplate.create({
      data: {
        name: "Test Template",
        description: "A test template",
        content: "# Test\nTemplate content",
        projectType: "web-app",
        isDefault: true,
      },
    });

    expect(template.id).toBeDefined();
    expect(template.name).toBe("Test Template");
    expect(template.isDefault).toBe(true);

    const found = await prisma.kickoffTemplate.findUnique({
      where: { id: template.id },
    });
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test Template");
  });
});

describe("Project model", () => {
  it("creates and reads a project", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Test Project",
        slug: "test-project",
        path: "/tmp/test-project",
        status: "building",
        health: "idle",
      },
    });

    expect(project.id).toBeDefined();
    expect(project.slug).toBe("test-project");
    expect(project.status).toBe("building");
    expect(project.autonomyMode).toBe("semi");
    expect(project.agentTeamsEnabled).toBe(false);

    const found = await prisma.project.findUnique({
      where: { slug: "test-project" },
    });
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test Project");
  });

  it("enforces unique slug", async () => {
    await expect(
      prisma.project.create({
        data: {
          name: "Duplicate",
          slug: "test-project",
          path: "/tmp/duplicate",
        },
      })
    ).rejects.toThrow();
  });

  it("links to kickoff template", async () => {
    const template = await prisma.kickoffTemplate.findFirst();
    await prisma.project.create({
      data: {
        name: "Linked Project",
        slug: "linked-project",
        path: "/tmp/linked",
        kickoffTemplateId: template!.id,
      },
    });

    const found = await prisma.project.findUnique({
      where: { slug: "linked-project" },
      include: { kickoffTemplate: true },
    });
    expect(found!.kickoffTemplate).not.toBeNull();
    expect(found!.kickoffTemplate!.name).toBe("Test Template");
  });
});

describe("KnowledgeLesson model", () => {
  it("creates and reads a lesson", async () => {
    const project = await prisma.project.findFirst();
    const lesson = await prisma.knowledgeLesson.create({
      data: {
        title: "Always use WAL mode with SQLite",
        content: "# WAL Mode\nEnable WAL for concurrent reads.",
        category: "database",
        severity: "important",
        sourceProjectId: project!.id,
        sourceFile: "prisma/schema.prisma",
        sourcePhase: "phase-1-foundation",
        tags: JSON.stringify(["sqlite", "prisma", "performance"]),
      },
    });

    expect(lesson.id).toBeDefined();
    expect(lesson.category).toBe("database");
    expect(lesson.severity).toBe("important");
    expect(lesson.verified).toBe(false);
    expect(lesson.timesReferenced).toBe(0);

    const parsed = JSON.parse(lesson.tags);
    expect(parsed).toContain("sqlite");
  });

  it("links back to source project", async () => {
    const lesson = await prisma.knowledgeLesson.findFirst({
      include: { sourceProject: true },
    });
    expect(lesson!.sourceProject).not.toBeNull();
    expect(lesson!.sourceProject!.slug).toBe("test-project");
  });
});

describe("AuditSnapshot model", () => {
  it("creates and reads an audit snapshot", async () => {
    const project = await prisma.project.findFirst();
    const snapshot = await prisma.auditSnapshot.create({
      data: {
        projectId: project!.id,
        phase: "phase-1-foundation",
        auditType: "test-audit",
        grade: "A",
        findings: JSON.stringify({ issues: [], passRate: 1.0 }),
        isRead: false,
      },
    });

    expect(snapshot.id).toBeDefined();
    expect(snapshot.auditType).toBe("test-audit");
    expect(snapshot.grade).toBe("A");
    expect(snapshot.isRead).toBe(false);

    const findings = JSON.parse(snapshot.findings);
    expect(findings.passRate).toBe(1.0);
  });
});

describe("ActivityEvent model", () => {
  it("creates a project-scoped event", async () => {
    const project = await prisma.project.findFirst();
    const event = await prisma.activityEvent.create({
      data: {
        projectId: project!.id,
        eventType: "phase-complete",
        summary: "Completed phase 1",
        details: JSON.stringify({ phase: "phase-1-foundation" }),
      },
    });

    expect(event.id).toBeDefined();
    expect(event.eventType).toBe("phase-complete");
    expect(event.projectId).toBe(project!.id);
  });

  it("creates a cross-project event (null projectId)", async () => {
    const event = await prisma.activityEvent.create({
      data: {
        eventType: "lesson-harvested",
        summary: "Harvested 5 lessons across all projects",
      },
    });

    expect(event.id).toBeDefined();
    expect(event.projectId).toBeNull();
  });
});

describe("seed script", () => {
  it("runs without errors", () => {
    expect(() => {
      execSync("npx tsx prisma/seed.ts", {
        cwd: path.resolve(__dirname, ".."),
        stdio: "pipe",
        env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      });
    }).not.toThrow();
  });
});
