import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { getRemainingWork } from "./work-reader";

const TEST_DIR = path.resolve(__dirname, "../.test-work-reader");

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

async function createPhasedProject(
  name: string,
  phases: Record<string, string[]>
): Promise<string> {
  const dir = path.join(TEST_DIR, name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const requestsDir = path.join(dir, "requests");
  for (const [phase, requests] of Object.entries(phases)) {
    const phaseDir = path.join(requestsDir, phase);
    await fs.mkdir(phaseDir, { recursive: true });
    for (const req of requests) {
      await fs.writeFile(path.join(phaseDir, req), `# ${req}\n`);
    }
  }

  return dir;
}

async function createFlatProject(
  name: string,
  requests: string[]
): Promise<string> {
  const dir = path.join(TEST_DIR, name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const requestsDir = path.join(dir, "requests");
  await fs.mkdir(requestsDir, { recursive: true });
  for (const req of requests) {
    await fs.writeFile(path.join(requestsDir, req), `# ${req}\n`);
  }

  return dir;
}

describe("getRemainingWork", () => {
  it("returns phases with request statuses for phased projects", async () => {
    const dir = await createPhasedProject("phased", {
      "phase-1-foundation": [
        "1.1-nextjs-scaffold.md",
        "1.2-database-schema.md",
        "1.3-scanner.md",
      ],
      "phase-2-dashboard": [
        "2.1-project-tile.md",
        "2.2-health-engine.md",
      ],
      "phase-3-knowledge": [
        "3.1-harvester.md",
        "3.2-search.md",
      ],
    });

    const result = await getRemainingWork(
      dir,
      "phase-2-dashboard",
      "2.2"
    );

    expect(result.type).toBe("phased");
    expect(result.phases).toHaveLength(3);

    // Phase 1: all done
    const p1 = result.phases[0];
    expect(p1.name).toBe("phase-1-foundation");
    expect(p1.requests.every((r) => r.status === "done")).toBe(true);

    // Phase 2: 2.1 done, 2.2 current
    const p2 = result.phases[1];
    expect(p2.requests[0].status).toBe("done");
    expect(p2.requests[1].status).toBe("current");
    expect(p2.isCurrent).toBe(true);

    // Phase 3: all upcoming
    const p3 = result.phases[2];
    expect(p3.requests.every((r) => r.status === "upcoming")).toBe(true);
    expect(p3.isCurrent).toBe(false);
  });

  it("extracts readable titles from filenames", async () => {
    const dir = await createPhasedProject("titles", {
      "phase-1-foundation": ["1.1-nextjs-scaffold.md"],
    });

    const result = await getRemainingWork(dir, "phase-1-foundation", null);
    expect(result.phases[0].requests[0].title).toBe("Nextjs Scaffold");
    expect(result.phases[0].requests[0].number).toBe("1.1");
  });

  it("handles flat sequential requests", async () => {
    const dir = await createFlatProject("flat", [
      "001-setup.md",
      "002-schema.md",
      "003-api.md",
      "004-auth.md",
    ]);

    const result = await getRemainingWork(
      dir,
      "phase-1-foundation",
      "003"
    );

    expect(result.type).toBe("flat");
    expect(result.phases).toHaveLength(1);

    const requests = result.phases[0].requests;
    expect(requests[0].status).toBe("done"); // 001
    expect(requests[1].status).toBe("done"); // 002
    expect(requests[2].status).toBe("current"); // 003
    expect(requests[3].status).toBe("upcoming"); // 004
  });

  it("returns empty for missing requests directory", async () => {
    const dir = path.join(TEST_DIR, "no-requests");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });

    const result = await getRemainingWork(dir, "phase-1-foundation", null);
    expect(result.phases).toEqual([]);
  });

  it("counts remaining requests", async () => {
    const dir = await createPhasedProject("counts", {
      "phase-1-foundation": ["1.1-a.md", "1.2-b.md"],
      "phase-2-dashboard": ["2.1-c.md", "2.2-d.md", "2.3-e.md"],
    });

    const result = await getRemainingWork(dir, "phase-2-dashboard", "2.2");
    // Done: 1.1, 1.2, 2.1 = 3. Current: 2.2. Upcoming: 2.3 = 1.
    expect(result.totalRequests).toBe(5);
    expect(result.completedRequests).toBe(3);
    expect(result.remainingRequests).toBe(1);
  });
});
