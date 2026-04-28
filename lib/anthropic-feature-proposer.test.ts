import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import {
  findGapsForProject,
  generateProposal,
  proposeForProject,
  proposeForAll,
  renderProposalReport,
  isFeatureProposeCommand,
  parseFeatureProposeArgs,
  buildProposalUserPrompt,
} from "@/lib/anthropic-feature-proposer";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-proposer.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;
let projectAId: number;
let projectBId: number;
let tmpRoot: string;

beforeAll(async () => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  pushTestSchema(TEST_DB_URL);

  // Seed two upstream features (one with detector, one without).
  await prisma.upstreamFeature.create({
    data: {
      vendor: "anthropic",
      name: "Stop Hook",
      category: "hook",
      description: "Fires when a Claude Code session ends.",
      integrationRecipe: "Add hooks.Stop entry to .claude/settings.json.",
      detector: "detectsStopHook",
      addedBy: "manual",
      source: "manual",
      confidence: 100,
    },
  });
  await prisma.upstreamFeature.create({
    data: {
      vendor: "anthropic",
      name: "Skills",
      category: "skill",
      description: "User-defined skills under .claude/skills/.",
      integrationRecipe: "Drop a SKILL.md file under .claude/skills/<name>/.",
      detector: "detectsSkills",
      addedBy: "manual",
      source: "manual",
      confidence: 100,
    },
  });
  await prisma.upstreamFeature.create({
    data: {
      vendor: "anthropic",
      name: "Plan Mode",
      category: "settings-flag",
      description: "Plan-first mode for non-trivial tasks.",
      integrationRecipe: "Use EnterPlanMode in agent invocations.",
      detector: null, // <-- no detector; should be excluded from gaps
      addedBy: "manual",
      source: "manual",
      confidence: 100,
    },
  });

  // Set up two projects on disk so proposeForProject has CLAUDE.md/settings to read.
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "cascade-proposer-"));

  const aPath = path.join(tmpRoot, "project-a");
  await fsp.mkdir(path.join(aPath, ".claude"), { recursive: true });
  await fsp.writeFile(
    path.join(aPath, "CLAUDE.md"),
    "# Project A\nUses agent teams. No Stop hook yet.",
  );
  await fsp.writeFile(
    path.join(aPath, ".claude", "settings.json"),
    JSON.stringify({ hooks: {} }),
  );

  const bPath = path.join(tmpRoot, "project-b");
  await fsp.mkdir(path.join(bPath, ".claude"), { recursive: true });
  await fsp.writeFile(path.join(bPath, "CLAUDE.md"), "# Project B");
  await fsp.writeFile(
    path.join(bPath, ".claude", "settings.json"),
    JSON.stringify({ hooks: { Stop: [{ matcher: "", hooks: [] }] } }),
  );

  const a = await prisma.project.create({
    data: { name: "project-a", slug: "project-a", path: aPath },
  });
  projectAId = a.id;
  const b = await prisma.project.create({
    data: { name: "project-b", slug: "project-b", path: bPath },
  });
  projectBId = b.id;

  // Mark Stop Hook as already used by project-b.
  const stopFeature = await prisma.upstreamFeature.findFirst({
    where: { name: "Stop Hook" },
  });
  await prisma.projectFeatureUsage.create({
    data: {
      projectId: projectBId,
      featureId: stopFeature!.id,
      signal: ".claude/settings.json hooks.Stop",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

// ----------------------------------------------------------------------------

describe("findGapsForProject", () => {
  it("returns features with detector that aren't in this project's usage ledger", async () => {
    const gaps = await findGapsForProject(prisma, projectAId);
    const names = gaps.map((g) => g.featureName);
    expect(names).toContain("Stop Hook");
    expect(names).toContain("Skills");
  });

  it("excludes features without a detector (we can't propose them)", async () => {
    const gaps = await findGapsForProject(prisma, projectAId);
    expect(gaps.find((g) => g.featureName === "Plan Mode")).toBeUndefined();
  });

  it("excludes features the project already uses", async () => {
    const gaps = await findGapsForProject(prisma, projectBId);
    expect(gaps.find((g) => g.featureName === "Stop Hook")).toBeUndefined();
    // Project B doesn't use Skills, so Skills should still be a gap.
    expect(gaps.find((g) => g.featureName === "Skills")).toBeDefined();
  });
});

// ----------------------------------------------------------------------------

describe("buildProposalUserPrompt", () => {
  it("includes the feature name, project name, and recipe", () => {
    const text = buildProposalUserPrompt({
      feature: {
        featureId: 1,
        featureName: "Stop Hook",
        category: "hook",
        description: "fires on session end",
        integrationRecipe: "add hooks.Stop",
      },
      projectName: "demo",
      projectPath: "/tmp/demo",
      claudeMd: "# demo",
      settingsJson: "{}",
    });
    expect(text).toContain("demo");
    expect(text).toContain("Stop Hook");
    expect(text).toContain("add hooks.Stop");
  });

  it("truncates large CLAUDE.md content", () => {
    const huge = "a".repeat(20_000);
    const text = buildProposalUserPrompt({
      feature: {
        featureId: 1,
        featureName: "x",
        category: "other",
        description: "",
        integrationRecipe: "",
      },
      projectName: "p",
      projectPath: "/p",
      claudeMd: huge,
      settingsJson: "{}",
    });
    expect(text.length).toBeLessThan(huge.length);
    expect(text).toContain("truncated");
  });
});

// ----------------------------------------------------------------------------

describe("generateProposal", () => {
  it("calls injected callClaude with system + user prompts and returns its output", async () => {
    let receivedSystem = "";
    let receivedUser = "";
    const result = await generateProposal(
      {
        feature: {
          featureId: 1,
          featureName: "Stop Hook",
          category: "hook",
          description: "x",
          integrationRecipe: "y",
        },
        projectName: "demo",
        projectPath: "/tmp/demo",
        claudeMd: "# demo",
        settingsJson: "{}",
      },
      {
        callClaude: async (sys, user) => {
          receivedSystem = sys;
          receivedUser = user;
          return "### .claude/settings.json\n```diff\n+ hooks.Stop\n```";
        },
      },
    );
    expect(receivedSystem).toContain("integration-diff generator");
    expect(receivedUser).toContain("Stop Hook");
    expect(result).toContain("hooks.Stop");
  });
});

// ----------------------------------------------------------------------------

describe("proposeForProject", () => {
  it("returns one proposal per gap up to maxFeatures", async () => {
    let calls = 0;
    const result = await proposeForProject(prisma, projectAId, {
      maxFeatures: 1,
      deps: {
        callClaude: async () => {
          calls++;
          return "MOCK_PROPOSAL_BODY";
        },
      },
    });
    expect(calls).toBe(1);
    expect(result.proposals.length).toBe(1);
    expect(result.proposals[0].markdown).toContain("MOCK_PROPOSAL_BODY");
  });

  it("captures Claude errors per-feature without aborting the batch", async () => {
    let attempt = 0;
    const result = await proposeForProject(prisma, projectAId, {
      maxFeatures: 2,
      deps: {
        callClaude: async () => {
          attempt++;
          if (attempt === 1) throw new Error("rate limited");
          return "OK";
        },
      },
    });
    expect(result.proposals.length).toBe(2);
    expect(result.proposals[0].error).toContain("rate limited");
    expect(result.proposals[1].markdown).toContain("OK");
  });
});

// ----------------------------------------------------------------------------

describe("proposeForAll", () => {
  it("audits every project by default", async () => {
    const results = await proposeForAll(prisma, {
      maxFeatures: 1,
      deps: { callClaude: async () => "MOCK" },
    });
    const names = results.map((r) => r.projectName);
    expect(names).toContain("project-a");
    expect(names).toContain("project-b");
  });

  it("filters to specific project slugs when provided", async () => {
    const results = await proposeForAll(prisma, {
      maxFeatures: 1,
      projectSlugs: ["project-b"],
      deps: { callClaude: async () => "MOCK" },
    });
    expect(results.length).toBe(1);
    expect(results[0].projectName).toBe("project-b");
  });
});

// ----------------------------------------------------------------------------

describe("renderProposalReport", () => {
  it("renders a Markdown summary + per-project sections", () => {
    const md = renderProposalReport([
      {
        projectName: "demo",
        projectPath: "/tmp/demo",
        proposals: [
          {
            feature: {
              featureId: 1,
              featureName: "Stop Hook",
              category: "hook",
              description: "x",
              integrationRecipe: "y",
            },
            markdown: "### file\n```diff\n+ hooks.Stop\n```",
          },
        ],
      },
    ]);
    expect(md).toContain("# Anthropic Feature Proposals");
    expect(md).toContain("## demo");
    expect(md).toContain("Stop Hook");
    expect(md).toContain("hooks.Stop");
    expect(md).toContain("Cascade does NOT");
  });

  it("handles empty results gracefully", () => {
    const md = renderProposalReport([]);
    expect(md).toContain("No projects to audit");
  });

  it("surfaces per-feature errors without dropping the project", () => {
    const md = renderProposalReport([
      {
        projectName: "p",
        projectPath: "/p",
        proposals: [
          {
            feature: {
              featureId: 1,
              featureName: "Stop Hook",
              category: "hook",
              description: "",
              integrationRecipe: "",
            },
            markdown: "",
            error: "Claude API rate-limited",
          },
        ],
      },
    ]);
    expect(md).toContain("rate-limited");
    expect(md).toContain("Stop Hook");
  });
});

// ----------------------------------------------------------------------------

describe("isFeatureProposeCommand + parseFeatureProposeArgs", () => {
  it("matches the slash command (case-insensitive)", () => {
    expect(isFeatureProposeCommand("/anthropic-feature-propose")).toBe(true);
    expect(isFeatureProposeCommand("/Anthropic-Feature-Propose")).toBe(true);
    expect(isFeatureProposeCommand("  /anthropic-feature-propose ")).toBe(true);
  });

  it("does not match the check command (different surface)", () => {
    expect(isFeatureProposeCommand("/anthropic-feature-update-check")).toBe(false);
  });

  it("parses optional trailing project slugs", () => {
    expect(parseFeatureProposeArgs("/anthropic-feature-propose").projectSlugs).toEqual([]);
    expect(
      parseFeatureProposeArgs("/anthropic-feature-propose ratracer").projectSlugs,
    ).toEqual(["ratracer"]);
    expect(
      parseFeatureProposeArgs(
        "/anthropic-feature-propose ratracer cascade --foo",
      ).projectSlugs,
    ).toEqual(["ratracer", "cascade"]);
  });
});
