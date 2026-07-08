/**
 * Phase 41.7 — infrastructure-version health dimension acceptance tests.
 *
 * Six of the eight acceptance-criteria rows from
 * requests/phase-41-trustworthy-fleet/41.7-infra-version-health.md live
 * here (the health-payload row lives in lib/health-engine.test.ts and the
 * briefing-surfacing row in app/api/briefing/route.test.ts).
 *
 * Every ~/.claude read is path-injected via options against scratch
 * fixtures under .test-infra/ — no real ~/.claude, ~/.claude.json, or the
 * live plugin symlink are ever touched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { computeInfraVersion } from "./infra-version";

const TEST_DIR = path.resolve(__dirname, "../.test-infra");

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

/** Write a plugin.json fixture and return its path. */
async function makePluginJson(name: string, version: string): Promise<string> {
  const dir = path.join(TEST_DIR, name, ".claude-plugin");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "plugin.json");
  await fs.writeFile(
    file,
    JSON.stringify({ name: "coqui-kickoff", version }, null, 2)
  );
  return file;
}

/** Write a ~/.claude.json fixture with the given projects map. */
async function makeClaudeConfig(
  name: string,
  projects: Record<string, Record<string, unknown>>
): Promise<string> {
  const file = path.join(TEST_DIR, `${name}.claude.json`);
  await fs.writeFile(file, JSON.stringify({ projects }, null, 2));
  return file;
}

/** Create a scratch project dir; returns its absolute path. */
async function makeProject(
  name: string,
  build: (dir: string) => Promise<void>
): Promise<string> {
  const dir = path.join(TEST_DIR, "projects", name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await build(dir);
  return dir;
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

describe("computeInfraVersion — plugin version", () => {
  it("reads and reports the plugin version", async () => {
    const pluginJsonPath = await makePluginJson("plugin-ok", "4.0.1");
    const projectPath = await makeProject("plain", async () => {});

    const info = await computeInfraVersion(projectPath, { pluginJsonPath });

    expect(info.plugin.installed).toBe(true);
    expect(info.plugin.version).toBe("4.0.1");
  });

  it("reports not-installed when the plugin.json is missing (no crash)", async () => {
    const projectPath = await makeProject("plain2", async () => {});

    const info = await computeInfraVersion(projectPath, {
      pluginJsonPath: path.join(TEST_DIR, "does", "not", "exist.json"),
    });

    expect(info.plugin.installed).toBe(false);
    expect(info.plugin.version).toBeNull();
  });
});

describe("computeInfraVersion — migration state", () => {
  it("flags v3.5 remnants by exact plugin-provided names", async () => {
    // A project-local skill that SHADOWS a plugin-provided name.
    const projectPath = await makeProject("shadowing", async (dir) => {
      await fs.mkdir(path.join(dir, ".claude", "skills", "bughunt"), {
        recursive: true,
      });
      await writeFile(
        path.join(dir, ".claude", "skills", "bughunt", "SKILL.md"),
        "# bughunt\n"
      );
    });

    const info = await computeInfraVersion(projectPath, {});

    expect(info.migrationState).toBe("v3.5-remnants");
    expect(info.remnants).toContain("skill:bughunt");
  });

  it("flags a session-context/secret-scan hook in project settings.json as a remnant", async () => {
    const projectPath = await makeProject("hooked", async (dir) => {
      await writeFile(
        path.join(dir, ".claude", "settings.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "bash .claude/scripts/session-context.sh",
                  },
                ],
              },
            ],
          },
        })
      );
    });

    const info = await computeInfraVersion(projectPath, {});

    expect(info.migrationState).toBe("v3.5-remnants");
    expect(info.remnants).toContain("hook:session-context");
  });

  it("does NOT treat custom-named machinery as a remnant (sharpes pattern → v4)", async () => {
    const projectPath = await makeProject("custom", async (dir) => {
      // Only custom skill/agent/command names — none match plugin names.
      for (const skill of ["audit-flags", "implement-request", "run-tests"]) {
        await writeFile(
          path.join(dir, ".claude", "skills", `${skill}.md`),
          `# ${skill}\n`
        );
      }
      await writeFile(
        path.join(dir, ".claude", "agents", "nerve-center.md"),
        "# nerve-center\n"
      );
      await writeFile(
        path.join(dir, ".claude", "commands", "seed-data.md"),
        "# seed-data\n"
      );
    });

    const info = await computeInfraVersion(projectPath, {});

    expect(info.migrationState).toBe("v4");
    expect(info.remnants).toEqual([]);
  });

  it("classifies a project with no .claude machinery as no-kickoff", async () => {
    const projectPath = await makeProject("bare", async (dir) => {
      await writeFile(path.join(dir, "README.md"), "# bare\n");
    });

    const info = await computeInfraVersion(projectPath, {});

    expect(info.migrationState).toBe("no-kickoff");
    expect(info.remnants).toEqual([]);
  });
});

describe("computeInfraVersion — workspace trust", () => {
  it("reads accepted trust from ~/.claude.json", async () => {
    const projectPath = await makeProject("trusted", async () => {});
    const claudeConfigPath = await makeClaudeConfig("accepted", {
      [projectPath]: { hasTrustDialogAccepted: true },
    });

    const info = await computeInfraVersion(projectPath, { claudeConfigPath });

    expect(info.workspaceTrust).toBe("accepted");
  });

  it("reports not-accepted when the trust dialog was declined", async () => {
    const projectPath = await makeProject("untrusted", async () => {});
    const claudeConfigPath = await makeClaudeConfig("declined", {
      [projectPath]: { hasTrustDialogAccepted: false },
    });

    const info = await computeInfraVersion(projectPath, { claudeConfigPath });

    expect(info.workspaceTrust).toBe("not-accepted");
  });

  it("reports unknown when the project entry is absent", async () => {
    const projectPath = await makeProject("no-entry", async () => {});
    const claudeConfigPath = await makeClaudeConfig("other-only", {
      "/some/other/project": { hasTrustDialogAccepted: true },
    });

    const info = await computeInfraVersion(projectPath, { claudeConfigPath });

    expect(info.workspaceTrust).toBe("unknown");
  });

  it("reports unknown when ~/.claude.json is unreadable (no crash)", async () => {
    const projectPath = await makeProject("no-config", async () => {});

    const info = await computeInfraVersion(projectPath, {
      claudeConfigPath: path.join(TEST_DIR, "missing.claude.json"),
    });

    expect(info.workspaceTrust).toBe("unknown");
  });
});
