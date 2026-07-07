import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import {
  pushTestSchema,
  gitInitWithAuthor,
} from "@/lib/__test-utils__/prisma-push";
import {
  auditPublishSafety,
  syncPublishSafetyTasks,
  clearVisibilityCache,
  type RepoVisibility,
} from "@/lib/publish-safety";
import { computeHealth } from "@/lib/health-engine";

// Scratch fixture repos — throwaway dirs, never real fleet projects.
const TEST_DIR = path.resolve(__dirname, "../.test-publish-safety");

// Isolated throwaway DB — never dev.db (test rules).
const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-publish-safety.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Fake secrets built by runtime concatenation so this test file never
// matches the secret patterns itself (in the pre-commit scan or when
// Cascade's own fleet audit scans this repo).
const FAKE_ANTHROPIC_KEY = ["sk-ant", "api03", "TESTFAKE00TESTFAKE00TESTFAKE"].join("-");
const FAKE_PG_URL =
  "postgres" + "://" + "admin:hunter2secretpw@db.internal.test:5432/prod";
const FAKE_SUPABASE_TOKEN = "sbp" + "_" + "0123456789abcdef0123456789abcdef";
const FAKE_SENTRY_TOKEN = "sntrys" + "_" + "eyJpYXQiOjE3MDAwMDAwMDAuMDAwfQ";

let prisma: PrismaClient;

beforeAll(async () => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  pushTestSchema(TEST_DB_URL);
});

afterAll(async () => {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  clearVisibilityCache();
  await prisma.humanTask.deleteMany({});
  await prisma.project.deleteMany({});
});

/**
 * Create a scratch git repo. Files in `tracked` are committed; files in
 * `untracked` are written after the initial commit.
 */
function makeRepo(
  name: string,
  tracked: Record<string, string>,
  untracked: Record<string, string> = {}
): string {
  const dir = path.join(TEST_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, contents] of Object.entries(tracked)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contents);
  }
  gitInitWithAuthor(dir);
  for (const [rel, contents] of Object.entries(untracked)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contents);
  }
  return dir;
}

const privateProbe = (): RepoVisibility => "private";

describe("auditPublishSafety — detection classes", () => {
  // AC row 1: tracked ephemeral file detected
  it("detects tracked ephemeral session files (handoff.md, sessions/, non-example .env)", async () => {
    const dir = makeRepo("ephemeral", {
      "README.md": "# fixture",
      ".claude/handoff.md": "# session handoff — should never be tracked",
      ".claude/sessions/2026-07-01.md": "session log",
      ".env": "APP_MODE=dev",
      ".env.example": "APP_MODE=",
    });

    const result = await auditPublishSafety(dir, {
      visibilityProbe: privateProbe,
    });
    const ephemeral = result.findings.filter(
      (f) => f.class === "tracked-ephemeral"
    );
    const files = ephemeral.map((f) => f.file);

    expect(files).toContain(".claude/handoff.md");
    expect(files).toContain(".claude/sessions/2026-07-01.md");
    expect(files).toContain(".env");
    expect(files).not.toContain(".env.example");
    expect(files).not.toContain("README.md");

    const handoff = ephemeral.find((f) => f.file === ".claude/handoff.md");
    expect(handoff).toBeDefined();
    expect(handoff?.category).toBe("review");
  });

  // AC row 2: tracked secret pattern detected
  it("detects secret patterns in tracked files (sk-ant, postgres URL, sbp_, sntrys_)", async () => {
    const dir = makeRepo("secrets", {
      "src/config.ts": `export const KEY = "${FAKE_ANTHROPIC_KEY}";`,
      "scripts/db.sh": `psql "${FAKE_PG_URL}"`,
      "docs/notes.md": `token one ${FAKE_SUPABASE_TOKEN} token two ${FAKE_SENTRY_TOKEN}`,
    });

    const result = await auditPublishSafety(dir, {
      visibilityProbe: privateProbe,
    });
    const secrets = result.findings.filter((f) => f.class === "tracked-secret");
    const files = secrets.map((f) => f.file);

    expect(files).toContain("src/config.ts");
    expect(files).toContain("scripts/db.sh");
    expect(files).toContain("docs/notes.md");

    const anthropic = secrets.find((f) => f.file === "src/config.ts");
    expect(anthropic?.category).toBe("credential");
  });

  // AC row 3: settings.local.json embedded credential detected
  it("detects credentials embedded in settings.local.json permission strings", async () => {
    const dir = makeRepo(
      "settings-cred",
      { "README.md": "# fixture" },
      {
        ".claude/settings.local.json": JSON.stringify(
          {
            permissions: {
              allow: [
                "Bash(pnpm test)",
                `Bash(psql ${FAKE_PG_URL})`,
              ],
            },
          },
          null,
          2
        ),
      }
    );

    const result = await auditPublishSafety(dir, {
      visibilityProbe: privateProbe,
    });
    const cred = result.findings.find((f) => f.class === "settings-credential");

    expect(cred).toBeDefined();
    expect(cred?.file).toBe(".claude/settings.local.json");
    expect(cred?.category).toBe("credential");
  });

  // AC row 5: clean project yields zero findings
  it("returns zero findings for a clean project and never probes visibility", async () => {
    const dir = makeRepo("clean", {
      "README.md": "# clean fixture",
      ".env.example": "API_KEY=",
      "src/index.ts": "export {};",
    });

    const probe = vi.fn((): RepoVisibility => "public");
    const result = await auditPublishSafety(dir, { visibilityProbe: probe });

    expect(result.findings).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });

  it("returns zero findings for a directory without git", async () => {
    const dir = path.join(TEST_DIR, "no-git");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "handoff.md"), "# untracked");

    const result = await auditPublishSafety(dir, {
      visibilityProbe: privateProbe,
    });
    expect(
      result.findings.filter((f) => f.class === "tracked-ephemeral")
    ).toEqual([]);
  });
});

describe("auditPublishSafety — public-repo severity", () => {
  // AC row 4: public repo escalates severity
  it("escalates the same finding to high severity when the repo is public", async () => {
    const dir = makeRepo("visibility", {
      ".claude/handoff.md": "# tracked handoff",
    });

    const pub = await auditPublishSafety(dir, {
      visibilityProbe: () => "public",
    });
    expect(pub.repoVisibility).toBe("public");
    expect(pub.findings.length).toBeGreaterThanOrEqual(1);
    for (const f of pub.findings) expect(f.severity).toBe("high");

    clearVisibilityCache();
    const priv = await auditPublishSafety(dir, {
      visibilityProbe: () => "private",
    });
    expect(priv.findings.length).toBe(pub.findings.length);
    for (const f of priv.findings) expect(f.severity).toBe("normal");
  });

  it("treats unknown/no-remote visibility as private (normal severity)", async () => {
    const dir = makeRepo("visibility-unknown", {
      ".claude/handoff.md": "# tracked handoff",
    });

    const result = await auditPublishSafety(dir, {
      visibilityProbe: () => "unknown",
    });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    for (const f of result.findings) expect(f.severity).toBe("normal");
  });

  it("caches the visibility probe per repo across audits", async () => {
    const dir = makeRepo("visibility-cache", {
      ".claude/handoff.md": "# tracked handoff",
    });

    const probe = vi.fn((): RepoVisibility => "public");
    await auditPublishSafety(dir, { visibilityProbe: probe });
    await auditPublishSafety(dir, { visibilityProbe: probe });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("syncPublishSafetyTasks — escalation to HumanTasks", () => {
  // AC row 6: findings create HumanTasks idempotently
  it("creates one HumanTask per distinct finding across repeated runs", async () => {
    const dir = makeRepo("tasks", {
      ".claude/handoff.md": "# tracked handoff",
      "src/config.ts": `export const KEY = "${FAKE_ANTHROPIC_KEY}";`,
    });

    const { findings } = await auditPublishSafety(dir, {
      visibilityProbe: privateProbe,
    });
    expect(findings.length).toBeGreaterThanOrEqual(2);

    await syncPublishSafetyTasks(prisma, { slug: "fixture-tasks" }, findings);
    await syncPublishSafetyTasks(prisma, { slug: "fixture-tasks" }, findings);

    const tasks = await prisma.humanTask.findMany({
      where: { projectSlug: "fixture-tasks" },
    });
    expect(tasks.length).toBe(findings.length);

    for (const task of tasks) {
      expect(["credential", "review"]).toContain(task.category);
    }
    // Ephemeral file → review; embedded secret → credential.
    expect(tasks.some((t) => t.category === "review")).toBe(true);
    expect(tasks.some((t) => t.category === "credential")).toBe(true);
  });
});

describe("redaction by construction", () => {
  // AC row 7: secrets never stored/logged verbatim
  it("stores only redacted forms (first 10 chars + ellipsis); raw value never reaches DB or logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      const dir = makeRepo(
        "redaction",
        { "src/config.ts": `export const KEY = "${FAKE_ANTHROPIC_KEY}";` },
        {
          ".claude/settings.local.json": JSON.stringify({
            permissions: { allow: [`Bash(psql ${FAKE_PG_URL})`] },
          }),
        }
      );

      const result = await auditPublishSafety(dir, {
        visibilityProbe: privateProbe,
      });
      await syncPublishSafetyTasks(
        prisma,
        { slug: "fixture-redaction" },
        result.findings
      );

      // Finding text carries the redacted form...
      const secret = result.findings.find((f) => f.class === "tracked-secret");
      expect(secret?.detail).toContain(FAKE_ANTHROPIC_KEY.slice(0, 10) + "…");
      // ...and never the raw value, anywhere in the result.
      expect(JSON.stringify(result)).not.toContain(FAKE_ANTHROPIC_KEY);
      expect(JSON.stringify(result)).not.toContain(FAKE_PG_URL);

      // Raw values absent from every DB row.
      const tasks = await prisma.humanTask.findMany({
        where: { projectSlug: "fixture-redaction" },
      });
      expect(tasks.length).toBeGreaterThanOrEqual(2);
      for (const task of tasks) {
        expect(task.title).not.toContain(FAKE_ANTHROPIC_KEY);
        expect(task.title).not.toContain(FAKE_PG_URL);
      }

      // Raw values absent from everything logged during audit + sync.
      const loggedArgs = [logSpy, warnSpy, errorSpy, infoSpy]
        .flatMap((spy) => spy.mock.calls)
        .flat()
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)));
      for (const logged of loggedArgs) {
        expect(logged).not.toContain(FAKE_ANTHROPIC_KEY);
        expect(logged).not.toContain(FAKE_PG_URL);
      }
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});

describe("fleet health surfacing", () => {
  // AC row 8: surfaced in fleet health
  it("computeHealth includes a publishSafety summary for the project", async () => {
    const dir = makeRepo("health", {
      ".claude/handoff.md": "# tracked handoff",
      "audits/debt.md": "# Debt\n\n## Open\n\n## Resolved\n",
    });

    const result = await computeHealth(dir, {
      visibilityProbe: privateProbe,
    });

    expect(result.publishSafety).toBeDefined();
    expect(result.publishSafety.findingsCount).toBeGreaterThanOrEqual(1);
    expect(result.publishSafety.repoVisibility).toBe("private");
    expect(
      result.publishSafety.findings.some(
        (f) => f.file === ".claude/handoff.md" && f.class === "tracked-ephemeral"
      )
    ).toBe(true);
  });

  it("computeHealth reports an empty publishSafety summary for a clean project", async () => {
    const dir = makeRepo("health-clean", {
      "README.md": "# clean",
      "audits/debt.md": "# Debt\n\n## Open\n\n## Resolved\n",
    });

    const result = await computeHealth(dir, {
      visibilityProbe: privateProbe,
    });

    expect(result.publishSafety).toBeDefined();
    expect(result.publishSafety.findingsCount).toBe(0);
    expect(result.publishSafety.findings).toEqual([]);
  });
});
