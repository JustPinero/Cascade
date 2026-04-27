import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execSync } from "child_process";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
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
  pushTestSchema(TEST_DB_URL);
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

describe("UpstreamFeature model (phase 11.1)", () => {
  it("creates a feature with the expected defaults", async () => {
    const feature = await prisma.upstreamFeature.create({
      data: {
        name: "Stop Hook",
        category: "hook",
        description: "Fires when a Claude Code session ends.",
        integrationRecipe: "Add hooks.Stop entry to .claude/settings.json.",
        detector: "detectsStopHook",
      },
    });

    expect(feature.id).toBeDefined();
    expect(feature.vendor).toBe("anthropic");
    expect(feature.source).toBe("manual");
    expect(feature.addedBy).toBe("manual");
    expect(feature.confidence).toBe(100);
    expect(feature.detector).toBe("detectsStopHook");
  });

  it("enforces unique (vendor, name)", async () => {
    await expect(
      prisma.upstreamFeature.create({
        data: {
          name: "Stop Hook",
          category: "hook",
          description: "duplicate",
          integrationRecipe: "duplicate",
        },
      })
    ).rejects.toThrow();
  });

  it("allows the same name under a different vendor", async () => {
    const feature = await prisma.upstreamFeature.create({
      data: {
        vendor: "openai",
        name: "Stop Hook",
        category: "hook",
        description: "Hypothetical OpenAI equivalent",
        integrationRecipe: "n/a",
      },
    });
    expect(feature.vendor).toBe("openai");
  });
});

describe("ProjectFeatureUsage model (phase 11.1)", () => {
  it("links a project to a detected feature", async () => {
    const project = await prisma.project.findFirst();
    const feature = await prisma.upstreamFeature.findFirst({
      where: { vendor: "anthropic" },
    });

    const usage = await prisma.projectFeatureUsage.create({
      data: {
        projectId: project!.id,
        featureId: feature!.id,
        signal: ".claude/settings.json hooks.Stop",
      },
    });

    expect(usage.id).toBeDefined();
    expect(usage.signal).toContain("Stop");
  });

  it("enforces unique (projectId, featureId)", async () => {
    const project = await prisma.project.findFirst();
    const feature = await prisma.upstreamFeature.findFirst({
      where: { vendor: "anthropic" },
    });

    await expect(
      prisma.projectFeatureUsage.create({
        data: {
          projectId: project!.id,
          featureId: feature!.id,
          signal: "duplicate",
        },
      })
    ).rejects.toThrow();
  });

  it("can be loaded with feature + project relations", async () => {
    const usage = await prisma.projectFeatureUsage.findFirst({
      include: { feature: true, project: true },
    });
    expect(usage!.feature.name).toBe("Stop Hook");
    expect(usage!.project.slug).toBeDefined();
  });
});

describe("CascadeConfig model (phase 11.1)", () => {
  it("upserts a single row keyed on id=1", async () => {
    const created = await prisma.cascadeConfig.upsert({
      where: { id: 1 },
      create: { id: 1, lastSeenClaudeCodeVersion: "1.0.0" },
      update: { lastSeenClaudeCodeVersion: "1.0.0" },
    });
    expect(created.id).toBe(1);
    expect(created.lastSeenClaudeCodeVersion).toBe("1.0.0");

    const updated = await prisma.cascadeConfig.upsert({
      where: { id: 1 },
      create: { id: 1, lastSeenClaudeCodeVersion: "1.0.1" },
      update: { lastSeenClaudeCodeVersion: "1.0.1" },
    });
    expect(updated.id).toBe(1);
    expect(updated.lastSeenClaudeCodeVersion).toBe("1.0.1");

    const all = await prisma.cascadeConfig.findMany();
    expect(all.length).toBe(1);
  });
});

describe("seed script", () => {
  const templatesPresent = fs.existsSync(
    path.resolve(__dirname, "../templates")
  );

  it.skipIf(!!process.env.CI || !templatesPresent)(
    "runs without errors",
    () => {
      expect(() => {
        execSync("npx tsx prisma/seed.ts", {
          cwd: path.resolve(__dirname, ".."),
          stdio: "pipe",
          env: { ...process.env, DATABASE_URL: TEST_DB_URL },
        });
      }).not.toThrow();
    }
  );
});
