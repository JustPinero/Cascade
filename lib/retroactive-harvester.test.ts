import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { execSync } from "child_process";

// We test the artifact gathering by importing the module and running
// it against scratch git fixture repos. The Claude API boundary is
// mocked — unit tests never hit api.anthropic.com (41.1: the real
// fetch here was nondeterministic network latency that blew the 5s
// vitest timeout).

const TEST_DIR = path.resolve(__dirname, "../.test-retro-harvest");

// Hermetic git: ignore the machine's global/system git config so
// commit signing, hooks, or credential helpers can't hang or alter
// the fixture repos.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(commands: string, cwd: string): void {
  execSync(commands, { cwd, stdio: "pipe", env: GIT_ENV });
}

// Mocked Anthropic boundary. Default: a 401 (fake key), which is the
// deterministic version of what these tests always exercised.
const fetchMock = vi.fn<typeof fetch>(
  async () =>
    new Response(JSON.stringify({ error: { type: "authentication_error" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
);

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchMock);
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  fetchMock.mockClear();
});

describe("retroactive-harvester module", () => {
  it("exports retroHarvestProject and retroHarvestAll", async () => {
    const mod = await import("./retroactive-harvester");
    expect(typeof mod.retroHarvestProject).toBe("function");
    expect(typeof mod.retroHarvestAll).toBe("function");
  });

  it("handles project with no artifacts gracefully", async () => {
    const dir = path.join(TEST_DIR, "empty-project");
    await fs.mkdir(dir, { recursive: true });

    const mod = await import("./retroactive-harvester");

    // Mock prisma — we expect it to fail gracefully since there are
    // no artifacts to send to Claude
    const mockPrisma = {
      project: { findUnique: async () => null },
      knowledgeLesson: { findFirst: async () => null, create: async () => ({}) },
      activityEvent: { create: async () => ({}) },
    };

    const result = await mod.retroHarvestProject(
      mockPrisma as never,
      dir,
      "Empty Project",
      "empty-project",
      "sk-fake-key"
    );

    expect(result.projectName).toBe("Empty Project");
    expect(result.artifactsGathered).toBe(0);
    expect(result.error).toBe("No historical artifacts found");
    // No artifacts means the Claude boundary is never reached.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gathers git history from a project with commits", async () => {
    const dir = path.join(TEST_DIR, "git-project");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "README.md"), "# Test");

    git(
      "git init && git add -A && git -c user.name=Cascade -c user.email=test@local.dev commit -m init",
      dir
    );
    // Add a fix commit
    await fs.writeFile(path.join(dir, "fix.txt"), "fixed");
    git(
      'git add -A && git -c user.name=Cascade -c user.email=test@local.dev commit -m "fix: resolved auth bug"',
      dir
    );

    const mod = await import("./retroactive-harvester");
    const mockPrisma = {
      project: { findUnique: async () => null },
      knowledgeLesson: { findFirst: async () => null, create: async () => ({}) },
      activityEvent: { create: async () => ({}) },
    };

    const result = await mod.retroHarvestProject(
      mockPrisma as never,
      dir,
      "Git Project",
      "git-project",
      "sk-fake-key"
    );

    // Should have gathered at least the git log artifact
    expect(result.artifactsGathered).toBeGreaterThanOrEqual(1);
    // The (mocked) Claude call fails with 401 — fake key
    expect(result.error).toContain("Claude API error: 401");
    // The boundary was exercised: exactly one call, to the Anthropic API
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "api.anthropic.com"
    );
  });

  it("gathers multiple artifact types", async () => {
    const dir = path.join(TEST_DIR, "full-project");
    await fs.mkdir(path.join(dir, ".claude"), { recursive: true });
    await fs.mkdir(path.join(dir, "audits"), { recursive: true });

    await fs.writeFile(path.join(dir, "CLAUDE.md"), "# Standards\nAlways use strict mode.");
    await fs.writeFile(
      path.join(dir, ".claude", "handoff.md"),
      "# Handoff\nCompleted phase 1."
    );
    await fs.writeFile(
      path.join(dir, "audits", "debt.md"),
      "# Debt\n\n## Open\n\n## Resolved\n- Fixed CORS issue\n- Resolved auth token bug\n"
    );

    git(
      'git init && git add -A && git -c user.name=Cascade -c user.email=test@local.dev commit -m "fix: initial setup"',
      dir
    );

    const mod = await import("./retroactive-harvester");
    const mockPrisma = {
      project: { findUnique: async () => null },
      knowledgeLesson: { findFirst: async () => null, create: async () => ({}) },
      activityEvent: { create: async () => ({}) },
    };

    const result = await mod.retroHarvestProject(
      mockPrisma as never,
      dir,
      "Full Project",
      "full-project",
      "sk-fake-key"
    );

    // Should have gathered git log + handoff + CLAUDE.md + resolved debt = 4 artifacts
    expect(result.artifactsGathered).toBeGreaterThanOrEqual(4);
  });

  it("stores lessons returned by Claude (mocked success path)", async () => {
    const dir = path.join(TEST_DIR, "lesson-project");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "CLAUDE.md"), "# Standards\nPin dependency versions.");

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify([
                {
                  title: "Pin Prisma adapter versions",
                  content:
                    "Mismatched adapter/client versions fail at runtime, not install time.",
                  severity: "important",
                },
              ]),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const created: Array<Record<string, unknown>> = [];
    const mockPrisma = {
      project: { findUnique: async () => null },
      knowledgeLesson: {
        findFirst: async () => null,
        create: async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return args.data;
        },
      },
      activityEvent: { create: async () => ({}) },
    };

    const mod = await import("./retroactive-harvester");
    const result = await mod.retroHarvestProject(
      mockPrisma as never,
      dir,
      "Lesson Project",
      "lesson-project",
      "sk-fake-key"
    );

    expect(result.error).toBeNull();
    expect(result.lessonsExtracted).toBe(1);
    expect(result.lessonsStored).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe("Pin Prisma adapter versions");
    expect(created[0].severity).toBe("important");
  });
});
