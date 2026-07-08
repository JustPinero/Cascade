/**
 * Phase 41.4 — morning briefing surfaces fleet reconciliation drift
 * (acceptance row 8: "briefing payload contains a drift section when
 * findings exist").
 *
 * Uses the @/lib/db proxy-injection boilerplate from the other rig-based
 * route tests, scratch project fixtures on disk, and a stubbed Anthropic
 * fetch — no real network, no dev.db.
 */
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => {
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      const inj = (globalThis as Record<string, unknown>).__rigPrisma;
      if (!inj) {
        throw new Error("rig prisma not injected — set __rigPrisma in the test");
      }
      return (inj as Record<string, unknown>)[prop as string];
    },
  });
  return { prisma: proxy };
});

import { POST } from "./route";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

const TEST_DIR = path.resolve(__dirname, "../../../.test-briefing-drift");

let rig: DispatchRig | null = null;
const envBefore = process.env.ANTHROPIC_API_KEY;

function stubAnthropic(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      content: [{ type: "text", text: "Good morning. All quiet." }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function makeCleanRepo(name: string): Promise<string> {
  const dir = path.join(TEST_DIR, name);
  await fs.mkdir(dir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "pipe" });
  await fs.writeFile(path.join(dir, "README.md"), `# ${name}\n`);
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "pipe" });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Cascade",
      "-c",
      "user.email=test@local.dev",
      "commit",
      "-m",
      "init",
    ],
    { cwd: dir, stdio: "pipe" }
  );
  return dir;
}

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
  process.env.ANTHROPIC_API_KEY = "sk-test-cascade-briefing";
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  if (envBefore === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = envBefore;
  }
});

afterEach(async () => {
  delete (globalThis as Record<string, unknown>).__rigPrisma;
  await rig?.dispose();
  rig = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function briefingRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/briefing", {
    method: "POST",
  });
}

describe("POST /api/briefing — reconciliation drift", () => {
  it("includes a drift section in the payload when findings exist", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    (globalThis as Record<string, unknown>).__rigPrisma = rig.prisma;
    const fetchMock = stubAnthropic();

    // A project whose DB path no longer exists on disk → path-missing drift.
    await rig.prisma.project.create({
      data: {
        name: "KickoffPrompts",
        slug: "kickoffprompts",
        path: path.join(TEST_DIR, "gone-forever"),
        status: "building",
      },
    });

    const res = await POST(briefingRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      briefing: string;
      drift: {
        findingsCount: number;
        section: string | null;
        projects: { slug: string }[];
      };
    };

    expect(body.drift).toBeDefined();
    expect(body.drift.findingsCount).toBeGreaterThanOrEqual(1);
    expect(body.drift.section).toBeTruthy();
    expect(body.drift.section).toContain("kickoffprompts");
    expect(body.drift.projects.map((p) => p.slug)).toContain("kickoffprompts");

    // The drift section is also fed to the model.
    const call = fetchMock.mock.calls[0] as unknown[];
    const init = call[1] as { body: string };
    expect(init.body).toContain("Reconciliation");
    expect(init.body).toContain("kickoffprompts");
  });

  it("flags projects with v3.5 remnants in the infra payload and feeds them to the model", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    (globalThis as Record<string, unknown>).__rigPrisma = rig.prisma;
    const fetchMock = stubAnthropic();

    // A project that shadows a plugin-provided skill name → v3.5-remnants.
    const remnantPath = await makeCleanRepo("remnant-project");
    await fs.mkdir(path.join(remnantPath, ".claude", "skills", "drift-audit"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(remnantPath, ".claude", "skills", "drift-audit", "SKILL.md"),
      "# drift-audit\n"
    );
    await rig.prisma.project.create({
      data: {
        name: "RemnantProject",
        slug: "remnant-project",
        path: remnantPath,
        status: "building",
      },
    });

    // Injected plugin + trust fixtures — never the real ~/.claude.
    const pluginJsonPath = path.join(TEST_DIR, "plugin.json");
    await fs.writeFile(
      pluginJsonPath,
      JSON.stringify({ name: "coqui-kickoff", version: "4.0.1" })
    );
    process.env.CASCADE_PLUGIN_JSON_PATH = pluginJsonPath;
    const claudeConfigPath = path.join(TEST_DIR, "claude.json");
    await fs.writeFile(claudeConfigPath, JSON.stringify({ projects: {} }));
    process.env.CASCADE_CLAUDE_CONFIG_PATH = claudeConfigPath;

    try {
      const res = await POST(briefingRequest());
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        infra: {
          plugin: { version: string | null };
          remnantProjects: { slug: string; remnants: string[] }[];
        };
      };

      expect(body.infra).toBeDefined();
      expect(body.infra.plugin.version).toBe("4.0.1");
      expect(body.infra.remnantProjects.map((p) => p.slug)).toContain(
        "remnant-project"
      );
      const flagged = body.infra.remnantProjects.find(
        (p) => p.slug === "remnant-project"
      );
      expect(flagged?.remnants).toContain("skill:drift-audit");

      // The remnant is fed to the model.
      const call = fetchMock.mock.calls[0] as unknown[];
      const init = call[1] as { body: string };
      expect(init.body).toContain("remnant-project");
    } finally {
      delete process.env.CASCADE_PLUGIN_JSON_PATH;
      delete process.env.CASCADE_CLAUDE_CONFIG_PATH;
    }
  });

  it("reports zero drift (null section) for a clean fleet", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    (globalThis as Record<string, unknown>).__rigPrisma = rig.prisma;
    stubAnthropic();

    const cleanPath = await makeCleanRepo("clean-fleet-project");
    await rig.prisma.project.create({
      data: {
        name: "CleanProject",
        slug: "clean-project",
        path: cleanPath,
        status: "building",
      },
    });

    const res = await POST(briefingRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      drift: { findingsCount: number; section: string | null };
    };

    expect(body.drift.findingsCount).toBe(0);
    expect(body.drift.section).toBeNull();
  });
});
